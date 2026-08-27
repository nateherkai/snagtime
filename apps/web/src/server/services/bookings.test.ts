import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cancelBooking, listManageRescheduleSlots, rescheduleBooking, resumeBookingCheckout } from "@/server/services/bookings";
import type { PaymentService } from "@/server/services/payments";
import { providerCalendarEventId, type CalendarService } from "@/server/services/calendar";
import { manageCookieName } from "@/server/auth/capabilities";
import { DELETE as deleteBooking, GET as getBooking, PATCH as patchBooking } from "@/app/api/bookings/[id]/route";
import { GET as getManageSlots } from "@/app/api/bookings/[id]/slots/route";
import { POST as resumeCheckoutRoute } from "@/app/api/bookings/[id]/checkout/resume/route";

describe("paid booking cancellation recovery", () => {
  beforeEach(() => { process.env.CALENDAR_PROVIDER = "local"; delete process.env.PAYMENTS_PROVIDER; });
  afterEach(() => { delete process.env.CALENDAR_PROVIDER; });
  it("releases pending-payment occupancy and persists a recovery reason", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, priceCents: 2500,
      inviteeName: "Checkout Cancel", inviteeEmail: "checkout-cancel@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-08-01T00:00:00Z"), endAt: new Date("2099-08-01T00:30:00Z"),
      status: "PENDING_PAYMENT", stripeCheckoutSessionId: `cs_test_${randomUUID()}`, stripePaymentStatus: "unpaid", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-01T00:00:00Z"),
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: new Date("2099-08-01T00:00:00Z") } },
    } });
    const result = await cancelBooking(bookingId, "Checkout abandoned");
    expect(result).toMatchObject({ status: "CANCELLED", cancellationReason: "Checkout abandoned" });
    expect(await db.bookingOccupancy.count({ where: { bookingId } })).toBe(0);
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("resumes Checkout from the server snapshot through the booking-specific HttpOnly session without client PII", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const sessionToken = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, priceCents: 2500,
      inviteeName: "Server Snapshot", inviteeEmail: "server-snapshot@example.invalid", inviteeTimeZone: "UTC", startAt: new Date("2099-08-02T00:00:00Z"), endAt: new Date("2099-08-02T00:30:00Z"),
      status: "PENDING_PAYMENT", stripePaymentStatus: "checkout_retry", checkoutResumeExpiresAt: new Date("2099-09-02T00:00:00Z"), idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-02T00:00:00Z"),
      manageSessions: { create: { tokenHash: createHash("sha256").update(sessionToken).digest("hex"), scopes: "read,cancel,reschedule", expiresAt: new Date("2099-09-02T00:00:00Z"), acknowledgedAt: new Date() } },
    } });
    let checkoutCalls = 0;
    const payments: PaymentService = {
      async createCheckout(booking) { checkoutCalls += 1; expect(booking.inviteeEmail).toBe("server-snapshot@example.invalid"); return { sessionId: "cs_test_resume", url: "https://checkout.stripe.test/resume" }; },
      async expireCheckout() {}, async refundPayment() { throw new Error("not used"); },
    };
    await expect(resumeBookingCheckout(bookingId, payments)).resolves.toEqual({ bookingId, status: "PENDING_PAYMENT", checkoutState: "READY", checkoutUrl: "https://checkout.stripe.test/resume" });
    await expect(resumeBookingCheckout(bookingId, payments)).resolves.toEqual({ bookingId, status: "PENDING_PAYMENT", checkoutState: "READY", checkoutUrl: "https://checkout.stripe.test/resume" });
    expect(checkoutCalls).toBe(1);
    const response = await resumeCheckoutRoute(new Request(`http://localhost:3000/api/bookings/${bookingId}/checkout/resume`, { method: "POST", headers: { origin: "http://localhost:3000", cookie: `${manageCookieName(bookingId)}=${sessionToken}` } }), { params: Promise.resolve({ id: bookingId }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.text(); expect(body).toContain('"checkoutState":"READY"'); expect(body).not.toContain("server-snapshot@example.invalid"); expect(body).not.toContain("Server Snapshot");
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("expires the opaque paid-resume authority without calling Stripe", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); let calls = 0;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, priceCents: 2500,
      inviteeName: "Expired Snapshot", inviteeEmail: "expired-snapshot@example.invalid", inviteeTimeZone: "UTC", startAt: new Date("2099-08-02T01:00:00Z"), endAt: new Date("2099-08-02T01:30:00Z"),
      status: "PENDING_PAYMENT", stripePaymentStatus: "checkout_retry", checkoutResumeExpiresAt: new Date("2020-01-01T00:00:00Z"), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-02T00:00:00Z"),
    } });
    const payments: PaymentService = { async createCheckout() { calls += 1; return null; }, async expireCheckout() {}, async refundPayment() { throw new Error("not used"); } };
    await expect(resumeBookingCheckout(bookingId, payments)).rejects.toThrow(/can no longer be resumed/); expect(calls).toBe(0);
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("cancels a paid booking only with a durable full-refund obligation and truthful email snapshot", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, priceCents: 2500, currency: "usd",
      inviteeName: "Paid Cancellation", inviteeEmail: "paid-cancellation@example.invalid", inviteeTimeZone: "UTC", startAt: new Date("2099-08-03T00:00:00Z"), endAt: new Date("2099-08-03T00:30:00Z"),
      status: "CONFIRMED", stripePaymentStatus: "paid", stripePaymentIntentId: "pi_paid_cancellation", refundStatus: "NOT_REQUIRED", capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-03T00:00:00Z"),
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: new Date("2099-08-03T00:00:00Z") } },
    } });
    await expect(cancelBooking(bookingId, "Customer requested cancellation")).resolves.toMatchObject({ status: "CANCELLED", refundStatus: "REFUND_PENDING", refundedAmountCents: 0 });
    expect(await db.integrationOutbox.findUnique({ where: { idempotencyKey: `stripe:refund:${bookingId}:full:v1` } })).toMatchObject({ kind: "STRIPE_REFUND", status: "RETRY" });
    const email = await db.emailOutbox.findFirstOrThrow({ where: { bookingId, kind: "BOOKING_CANCELLED", recipientEmail: "paid-cancellation@example.invalid" } });
    expect(JSON.parse(email.payloadJson)).toMatchObject({ paymentTruth: "Paid; refund pending", priceCents: 2500, currency: "usd" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("cannot reoccupy a booking when cancellation wins during slot revalidation", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "CAS Race", inviteeEmail: "cas-race@example.com", inviteeTimeZone: "America/Chicago", startAt: new Date("2099-08-25T15:00:00Z"), endAt: new Date("2099-08-25T15:30:00Z"), status: "CONFIRMED", bookingWindowDays: 30000,
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-25T00:00:00Z"),
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: new Date("2099-08-25T15:00:00Z") } },
    } });
    let canceled = false;
    const calendar: CalendarService = {
      async getBusyIntervals() { if (!canceled) { canceled = true; await cancelBooking(bookingId, "Concurrent cancellation"); } return []; },
      async createBookingEvent() { return null; }, async updateBookingEvent() {}, async deleteBookingEvent() {},
    };
    await expect(rescheduleBooking(bookingId, "2099-08-24T15:00:00.000Z", calendar)).rejects.toThrow(/changed while rescheduling/);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", mutationVersion: 1 });
    expect(await db.bookingOccupancy.count({ where: { bookingId } })).toBe(0);
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("lists manage-authorized reschedule slots without blocking on the current booking", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    const startAt = new Date("2099-08-25T15:00:00Z");
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Manage Slots", inviteeEmail: "manage-slots@example.com", inviteeTimeZone: "America/Chicago", startAt, endAt: new Date("2099-08-25T15:30:00Z"), status: "CONFIRMED",
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-25T00:00:00Z"), calendarProviderSnapshot: "google", bookingWindowDays: 30000,
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: startAt } },
    } });
    await db.eventType.update({ where: { id: event.id }, data: { isActive: false, bookingWindowDays: 1, bufferBeforeMinutes: 45, bufferAfterMinutes: 45 } });
    await db.eventDuration.update({ where: { id: duration.id }, data: { durationMinutes: 60 } });
    let excludedProviderEvent: string | null = null; let busyFrom: Date | null = null;
    const calendar: CalendarService = { async getBusyIntervals() { throw new Error("opaque freebusy must not be used"); }, async getBusyIntervalsExcludingEvent(_userId, from, _to, eventId) { excludedProviderEvent = eventId; busyFrom = from; return []; }, async createBookingEvent() { return null; }, async updateBookingEvent() {}, async deleteBookingEvent() {} };
    const slots = await listManageRescheduleSlots(bookingId, new Date("2099-08-25T00:00:00Z"), new Date("2099-08-26T00:00:00Z"), "America/Chicago", duration.id, calendar);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.durationMinutes === 30)).toBe(true);
    expect(busyFrom).toEqual(new Date("2099-08-25T00:00:00Z"));
    expect(slots.some((slot) => new Date(slot.start).getTime() === startAt.getTime())).toBe(false);
    expect(excludedProviderEvent).toBe(providerCalendarEventId(bookingId));
    await db.booking.delete({ where: { id: bookingId } }); await db.eventDuration.update({ where: { id: duration.id }, data: { durationMinutes: duration.durationMinutes } }); await db.eventType.update({ where: { id: event.id }, data: { isActive: true, bookingWindowDays: event.bookingWindowDays, bufferBeforeMinutes: event.bufferBeforeMinutes, bufferAfterMinutes: event.bufferAfterMinutes } });
  });

  it("refuses cancellation while an authoritative calendar mutation lease is active", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Lease Fence", inviteeEmail: "lease-fence@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-08-06T00:00:00Z"), endAt: new Date("2099-08-06T00:30:00Z"), status: "CONFIRMED",
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-06T00:00:00Z"), calendarLeaseToken: "active-provider-call", calendarLeaseExpiresAt: new Date("2099-08-01T00:00:00Z"),
    } });
    await expect(cancelBooking(bookingId, "must wait")).rejects.toThrow(/changed while cancellation/);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED", calendarLeaseToken: "active-provider-call" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("rejects an authenticated reschedule before availability when provider lineage needs recovery", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const sessionToken = randomUUID(); const originalStart = new Date("2099-08-07T00:00:00Z");
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Provider Recovery", inviteeEmail: "provider-recovery@example.com", inviteeTimeZone: "UTC", startAt: originalStart, endAt: new Date("2099-08-07T00:30:00Z"), status: "CONFIRMED", calendarProviderSnapshot: "provider_recovery_required", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-07T00:00:00Z"),
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: originalStart } }, manageSessions: { create: { tokenHash: createHash("sha256").update(sessionToken).digest("hex"), scopes: "read,cancel,reschedule", expiresAt: new Date("2099-09-07T00:00:00Z"), acknowledgedAt: new Date() } },
    } });
    const response = await patchBooking(new Request(`http://localhost:3000/api/bookings/${bookingId}`, { method: "PATCH", headers: { origin: "http://localhost:3000", cookie: `${manageCookieName(bookingId)}=${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ startAt: "2099-08-08T00:00:00Z" }) }), { params: Promise.resolve({ id: bookingId }) });
    expect(response.status).toBe(503); expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ startAt: originalStart, mutationVersion: 0, calendarProviderSnapshot: "provider_recovery_required" });
    expect(await db.bookingOccupancy.count({ where: { bookingId } })).toBe(1); await db.booking.delete({ where: { id: bookingId } });
  });

  it("supports two successive manage-session reschedules and makes same-start replay a no-op", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const sessionToken = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Successive Reschedule", inviteeEmail: "successive@example.com", inviteeTimeZone: "America/Chicago", startAt: new Date("2099-08-25T15:00:00Z"), endAt: new Date("2099-08-25T15:30:00Z"), status: "CONFIRMED", bookingWindowDays: 30000,
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-09-25T00:00:00Z"),
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: new Date("2099-08-25T15:00:00Z") } },
      manageSessions: { create: { tokenHash: createHash("sha256").update(sessionToken).digest("hex"), scopes: "read,cancel,reschedule", expiresAt: new Date("2099-09-25T00:00:00Z"), acknowledgedAt: new Date("2099-08-21T00:00:00Z") } },
    } });
    const call = (startAt: string) => patchBooking(new Request(`http://localhost:3000/api/bookings/${bookingId}`, { method: "PATCH", headers: { origin: "http://localhost:3000", cookie: `${manageCookieName(bookingId)}=${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ startAt }) }), { params: Promise.resolve({ id: bookingId }) });
    expect((await getManageSlots(new Request(`http://localhost:3000/api/bookings/${bookingId}/slots?from=2099-08-24T00:00:00Z&to=2099-08-25T00:00:00Z&timeZone=Not/AZone`, { headers: { cookie: `${manageCookieName(bookingId)}=${sessionToken}` } }), { params: Promise.resolve({ id: bookingId }) })).status).toBe(400);
    for (let index = 0; index < 35; index += 1) expect((await getBooking(new Request(`http://localhost:3000/api/bookings/${bookingId}`, { headers: { cookie: `${manageCookieName(bookingId)}=${sessionToken}` } }), { params: Promise.resolve({ id: bookingId }) })).status).toBe(200);
    expect((await call("2099-08-24T15:00:00.000Z")).status).toBe(200);
    expect((await call("2099-08-26T15:00:00.000Z")).status).toBe(200);
    expect((await call("2099-08-26T15:00:00.000Z")).status).toBe(200);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ startAt: new Date("2099-08-26T15:00:00.000Z"), mutationVersion: 2 });
    expect(await db.integrationOutbox.count({ where: { bookingId, kind: "CALENDAR_UPDATE" } })).toBe(2);
    expect((await deleteBooking(new Request(`http://localhost:3000/api/bookings/${bookingId}`, { method: "DELETE", headers: { origin: "http://localhost:3000", cookie: `${manageCookieName(bookingId)}=${sessionToken}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "Completed flow" }) }), { params: Promise.resolve({ id: bookingId }) })).status).toBe(200);
    await db.booking.delete({ where: { id: bookingId } });
  });
});
