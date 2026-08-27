import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cancelBooking } from "@/server/services/bookings";
import { CALENDAR_LEASE_MS, INTEGRATION_MAX_ATTEMPTS, processOutbox, recordOutboxRetry, withProviderDeadline } from "@/server/services/outbox";
import { CALENDAR_PROVIDER_TIMEOUT_MS, providerCalendarEventId } from "@/server/services/calendar";
import type { CalendarService } from "@/server/services/calendar";
import type { PaymentService } from "@/server/services/payments";

describe("calendar outbox ownership and lease recovery", () => {
  beforeEach(() => { process.env.CALENDAR_PROVIDER = "local"; });
  afterEach(() => { delete process.env.CALENDAR_PROVIDER; delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN; delete process.env.GOOGLE_ENV_WORKSPACE_ID; delete process.env.DEMO_MODE; });

  it("bounds provider calls substantially below the authoritative lease", async () => {
    expect(CALENDAR_LEASE_MS).toBeGreaterThan(CALENDAR_PROVIDER_TIMEOUT_MS * 4);
    await expect(withProviderDeadline(new Promise(() => undefined), 5)).rejects.toThrow(/CALENDAR_PROVIDER_TIMEOUT/);
  });

  it("stops before claims/provider calls and terminalizes the bounded retry budget", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: { id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Stop Test", inviteeEmail: "stop@example.invalid", inviteeTimeZone: "UTC", startAt: new Date("2099-04-01T00:00:00Z"), endAt: new Date("2099-04-01T00:30:00Z"), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-05-01T00:00:00Z") } });
    const effect = await db.integrationOutbox.create({ data: { workspaceId: event.workspaceId, bookingId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:stop` } });
    let providerCalls = 0; const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { providerCalls += 1; return null; }, async updateBookingEvent() { providerCalls += 1; }, async deleteBookingEvent() { providerCalls += 1; } };
    const controller = new AbortController(); controller.abort(); expect((await processOutbox(event.workspaceId, bookingId, new Date(), calendar, undefined, controller.signal)).attempted).toBe(0); expect(providerCalls).toBe(0);
    await db.integrationOutbox.update({ where: { id: effect.id }, data: { status: "PROCESSING", leaseToken: "terminal-lease", leaseExpiresAt: new Date("2099-05-01T00:00:00Z"), attemptCount: INTEGRATION_MAX_ATTEMPTS } });
    expect(await recordOutboxRetry({ id: effect.id, bookingId, kind: effect.kind, attemptCount: INTEGRATION_MAX_ATTEMPTS - 1 }, event.workspaceId, "terminal-lease", undefined, new Date())).toBe(true);
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { id: effect.id } })).toMatchObject({ status: "DEAD", lastErrorCode: "PROVIDER_OPERATION_FAILED" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("releases a claimed effect and its calendar lease when shutdown aborts the provider", async()=>{
    const event=await db.eventType.findFirstOrThrow({include:{durations:true}}),duration=event.durations[0]!,bookingId=randomUUID(),controller=new AbortController();
    await db.booking.create({data:{id:bookingId,workspaceId:event.workspaceId,eventTypeId:event.id,hostId:event.ownerId,durationId:duration.id,durationMinutes:duration.durationMinutes,inviteeName:"Shutdown",inviteeEmail:"shutdown@example.invalid",inviteeTimeZone:"UTC",startAt:new Date("2099-04-02T00:00:00Z"),endAt:new Date("2099-04-02T00:30:00Z"),capabilityVersion:randomUUID(),manageExpiresAt:new Date("2099-05-02T00:00:00Z"),outboxEffects:{create:{workspaceId:event.workspaceId,kind:"CALENDAR_CREATE",idempotencyKey:`calendar:create:${bookingId}:shutdown`}}}});
    const calendar:CalendarService={async getBusyIntervals(){return[]},async createBookingEvent(){controller.abort();throw new Error("provider aborted")},async updateBookingEvent(){},async deleteBookingEvent(){}};
    await processOutbox(event.workspaceId,bookingId,new Date(),calendar,undefined,controller.signal);
    expect(await db.integrationOutbox.findFirstOrThrow({where:{bookingId}})).toMatchObject({status:"RETRY",attemptCount:0,lastErrorCode:"WORKER_STOPPED",leaseToken:null,leaseExpiresAt:null});
    expect(await db.booking.findUniqueOrThrow({where:{id:bookingId}})).toMatchObject({calendarLeaseToken:null,calendarLeaseExpiresAt:null});await db.booking.delete({where:{id:bookingId}});
  });

  it("rejects another owner and reclaims only an expired lease", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Outbox Test", inviteeEmail: "outbox@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-01T00:00:00Z"), endAt: new Date("2099-02-01T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-01T00:00:00Z"), calendarSyncStatus: "PENDING", notificationStatus: "PENDING",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:test`, status: "PROCESSING", leaseToken: "dead-worker", leaseExpiresAt: new Date("2020-01-01T00:00:00Z") } },
    } });
    expect((await processOutbox("not-the-owner", bookingId)).attempted).toBe(0);
    expect((await processOutbox(event.workspaceId, bookingId)).attempted).toBe(1);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.calendarSyncStatus).toBe("LOCAL"); expect(booking.notificationStatus).toBe("LOCAL_NO_EMAIL");
    expect((await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).status).toBe("COMPLETED");
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("records a durable delete tombstone when cancellation wins during provider create", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Cancel Race", inviteeEmail: "cancel-race@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-02T00:00:00Z"), endAt: new Date("2099-02-02T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-02T00:00:00Z"), calendarProviderSnapshot: "google", calendarSyncStatus: "PENDING", notificationStatus: "PENDING",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:race` } },
    } });
    const racingCalendar: CalendarService = {
      async getBusyIntervals() { return []; },
      async createBookingEvent() { await db.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } }); return "provider-race-event"; },
      async updateBookingEvent() {}, async deleteBookingEvent() {}, async candidateEventId() { return "provider-race-event"; },
    };
    await processOutbox(event.workspaceId, bookingId, new Date(), racingCalendar);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", externalCalendarEventId: null, calendarSyncStatus: "PENDING", notificationStatus: "RETRY_PENDING" });
    await db.integrationOutbox.updateMany({ where: { workspaceId: event.workspaceId, bookingId, kind: "CALENDAR_CREATE" }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    await processOutbox(event.workspaceId, bookingId, new Date(), racingCalendar);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking).toMatchObject({ status: "CANCELLED", externalCalendarEventId: "provider-race-event", calendarSyncStatus: "PENDING", notificationStatus: "PENDING" });
    expect(await db.integrationOutbox.findUnique({ where: { idempotencyKey: `calendar:delete-tombstone:${bookingId}:provider-race-event` } })).toMatchObject({ kind: "CALENDAR_DELETE", status: "PENDING" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("does not mislabel a Stripe expiry retry as a calendar notification retry", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Stripe Retry", inviteeEmail: "stripe-retry@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-03T00:00:00Z"), endAt: new Date("2099-02-03T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-03T00:00:00Z"), status: "CANCELLED", stripeCheckoutSessionId: "cs_test_retry", notificationStatus: "LOCAL_NO_EMAIL",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "STRIPE_EXPIRE", idempotencyKey: `stripe:expire:${bookingId}` } },
    } });
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { return null; }, async updateBookingEvent() {}, async deleteBookingEvent() {} };
    const payments: PaymentService = { async createCheckout() { return null; }, async expireCheckout() { throw new Error("provider unavailable"); }, async refundPayment() { throw new Error("provider unavailable"); } };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar, payments);
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).notificationStatus).toBe("LOCAL_NO_EMAIL");
    expect((await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).status).toBe("RETRY");
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("retries a failed refund effect and records the exact full-refund authority once it succeeds", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      priceCents: 2500, currency: "usd", inviteeName: "Refund Retry", inviteeEmail: "refund-retry@example.invalid", inviteeTimeZone: "UTC",
      startAt: new Date("2099-02-03T01:00:00Z"), endAt: new Date("2099-02-03T01:30:00Z"), status: "CANCELLED", stripePaymentStatus: "paid", stripePaymentIntentId: "pi_refund_retry", refundStatus: "REFUND_PENDING",
      capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-03T00:00:00Z"),
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "STRIPE_REFUND", idempotencyKey: `stripe:refund:${bookingId}:full:v1` } },
    } });
    let calls = 0;
    const payments: PaymentService = {
      async createCheckout() { return null; }, async expireCheckout() {},
      async refundPayment() { calls += 1; if (calls === 1) throw new Error("provider timeout"); return { refundId: "re_refund_retry", status: "succeeded", failureCode: null }; },
    };
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { return null; }, async updateBookingEvent() {}, async deleteBookingEvent() {} };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar, payments);
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId, kind: "STRIPE_REFUND" } })).toMatchObject({ status: "RETRY", attemptCount: 1 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ refundStatus: "REFUND_PENDING", refundedAmountCents: 0 });
    await db.integrationOutbox.updateMany({ where: { bookingId, kind: "STRIPE_REFUND" }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar, payments);
    expect(calls).toBe(2);
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId, kind: "STRIPE_REFUND" } })).toMatchObject({ status: "COMPLETED" });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ refundStatus: "REFUNDED", stripeRefundId: "re_refund_retry", refundedAmountCents: 2500 });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("never calls the provider for a create job whose booking is already canceled", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); let creates = 0; let deletes = 0;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Already Cancelled", inviteeEmail: "already-cancelled@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-04T00:00:00Z"), endAt: new Date("2099-02-04T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-04T00:00:00Z"), status: "CANCELLED", calendarProviderSnapshot: "google", notificationStatus: "PENDING",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:cancelled` } },
    } });
    const candidate = `deterministic-${bookingId}`;
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { creates += 1; return "must-not-exist"; }, async updateBookingEvent() {}, async deleteBookingEvent() { deletes += 1; }, async candidateEventId() { return candidate; } };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(creates).toBe(0);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: candidate, notificationStatus: "PENDING" });
    expect(await db.integrationOutbox.findUnique({ where: { idempotencyKey: `calendar:delete-tombstone:${bookingId}:${candidate}` } })).toMatchObject({ kind: "CALENDAR_DELETE", status: "PENDING" });
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(deletes).toBe(1);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: null, notificationStatus: "GOOGLE_UPDATE_ACCEPTED" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("skips a retried calendar update after the booking lifecycle changed", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); let updates = 0;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Stale Update", inviteeEmail: "stale-update@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-05T00:00:00Z"), endAt: new Date("2099-02-05T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-05T00:00:00Z"), status: "CANCELLED", mutationVersion: 2, externalCalendarEventId: "provider-stale-event",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_UPDATE", bookingMutationVersion: 1, idempotencyKey: `calendar:update:${bookingId}:stale` } },
    } });
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { return null; }, async updateBookingEvent() { updates += 1; }, async deleteBookingEvent() {} };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(updates).toBe(0);
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).toMatchObject({ status: "COMPLETED", lastErrorCode: "STALE_CALENDAR_UPDATE" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("records only the declared accepted-update state after Google deletion", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); let deletes = 0;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Delete Status", inviteeEmail: "delete-status@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-06T00:00:00Z"), endAt: new Date("2099-02-06T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-06T00:00:00Z"), status: "CANCELLED", externalCalendarEventId: "provider-delete-event", notificationStatus: "PENDING",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete:${bookingId}:status` } },
    } });
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { return null; }, async updateBookingEvent() {}, async deleteBookingEvent() { deletes += 1; } };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(deletes).toBe(1);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: null, notificationStatus: "GOOGLE_UPDATE_ACCEPTED" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("retains the deterministic external id and retries when accepted Google credentials are unavailable", async () => {
    process.env.CALENDAR_PROVIDER = "google";
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const eventId = `provider-${randomUUID()}`;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Strict Retry", inviteeEmail: "strict-retry@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-07T00:00:00Z"), endAt: new Date("2099-02-07T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-07T00:00:00Z"), status: "CANCELLED", calendarProviderSnapshot: "google", externalCalendarEventId: eventId,
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete:${bookingId}:strict` } },
    } });
    await processOutbox(event.workspaceId, bookingId);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: eventId, notificationStatus: "RETRY_PENDING", calendarLeaseToken: null });
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).toMatchObject({ status: "RETRY", lastErrorCode: "PROVIDER_OPERATION_FAILED" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("does not attach an ambiguous create result after its calendar lease fence is lost", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID();
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Fence Loss", inviteeEmail: "fence-loss@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-08T00:00:00Z"), endAt: new Date("2099-02-08T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-08T00:00:00Z"), status: "CONFIRMED", calendarSyncStatus: "PENDING",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:fence` } },
    } });
    const calendar: CalendarService = {
      async getBusyIntervals() { return []; },
      async createBookingEvent() { await db.booking.update({ where: { id: bookingId }, data: { calendarLeaseToken: "stolen-fence" } }); return `deterministic-${bookingId}`; },
      async updateBookingEvent() {}, async deleteBookingEvent() {},
    };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: null, calendarLeaseToken: "stolen-fence", notificationStatus: "LOCAL_NO_EMAIL" });
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).toMatchObject({ status: "RETRY", lastErrorCode: "PROVIDER_OPERATION_FAILED" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("reconciles an ambiguous Google create before applying a later reschedule update", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const candidate = `tc-reconciled-${bookingId}`;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Ambiguous Reconcile", inviteeEmail: "ambiguous@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-09T01:00:00Z"), endAt: new Date("2099-02-09T01:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-09T00:00:00Z"), status: "CONFIRMED", mutationVersion: 1, calendarProviderSnapshot: "google", calendarSyncStatus: "PENDING",
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_UPDATE", bookingMutationVersion: 1, idempotencyKey: `calendar:update:${bookingId}:reconcile` } },
    } });
    let updates = 0; const calendar: CalendarService = {
      async getBusyIntervals() { return []; }, async createBookingEvent() { return candidate; },
      async updateBookingEvent(booking) { updates += 1; expect(booking.externalCalendarEventId).toBeNull(); if (updates === 1) throw Object.assign(new Error("provider precondition"), { code: 412 }); return { eventId: candidate, etag: '"etag-current"' }; }, async deleteBookingEvent() {},
    };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: null, notificationStatus: "RETRY_PENDING" });
    await db.integrationOutbox.updateMany({ where: { bookingId }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(updates).toBe(2);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: candidate, externalCalendarEventEtag: '"etag-current"', calendarSyncStatus: "SYNCED" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("keeps a deterministic Google tombstone until a later materialized event is deleted", async () => {
    const base = new Date(); const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const candidate = `ambiguous-${bookingId}`; let deletes = 0; let materialized = false;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Delete Horizon", inviteeEmail: "delete-horizon@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-10T00:00:00Z"), endAt: new Date("2099-02-10T00:30:00Z"), status: "CANCELLED", calendarProviderSnapshot: "google", externalCalendarEventId: candidate, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-10T00:00:00Z"),
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete:${bookingId}:ambiguity`, createdAt: base, nextAttemptAt: base } },
    } });
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { return null; }, async updateBookingEvent() {}, async deleteBookingEvent() { deletes += 1; return { eventId: candidate, providerAbsent: !materialized }; } };
    await processOutbox(event.workspaceId, bookingId, base, calendar);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: candidate, notificationStatus: "RETRY_PENDING" });
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).toMatchObject({ status: "RETRY", lastErrorCode: "PROVIDER_OPERATION_FAILED" });
    await db.integrationOutbox.updateMany({ where: { bookingId }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    await processOutbox(event.workspaceId, bookingId, new Date(base.getTime() + 24 * 60 * 60_000), calendar);
    expect(deletes).toBe(2); expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: candidate, notificationStatus: "RETRY_PENDING" });
    materialized = true;
    await db.integrationOutbox.updateMany({ where: { bookingId }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    await processOutbox(event.workspaceId, bookingId, new Date(base.getTime() + 7 * 24 * 60 * 60_000), calendar);
    expect(deletes).toBe(3); expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: null, calendarSyncStatus: "LOCAL" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("marks an upgraded in-flight create as provider recovery required and never silently no-ops it", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); let creates = 0;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Upgrade Recovery", inviteeEmail: "upgrade-recovery@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-11T00:00:00Z"), endAt: new Date("2099-02-11T00:30:00Z"), status: "CONFIRMED", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-11T00:00:00Z"),
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:upgrade` } },
    } });
    await db.$executeRawUnsafe(`UPDATE "Booking" SET "calendarProviderSnapshot" = 'provider_recovery_required' WHERE "externalCalendarEventId" IS NULL AND EXISTS (SELECT 1 FROM "IntegrationOutbox" WHERE "IntegrationOutbox"."bookingId" = "Booking"."id" AND "kind" = 'CALENDAR_CREATE' AND "status" IN ('PENDING', 'RETRY', 'PROCESSING'))`);
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { creates += 1; return null; }, async updateBookingEvent() {}, async deleteBookingEvent() {} };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(creates).toBe(0); expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ calendarProviderSnapshot: "provider_recovery_required", notificationStatus: "RETRY_PENDING" });
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId } })).toMatchObject({ status: "RETRY" });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("converges upgrade cancellation by deleting the deterministic event and superseding a poisoned create", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const deterministicId = providerCalendarEventId(bookingId); let deletes = 0; let creates = 0;
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Upgrade Cancel", inviteeEmail: "upgrade-cancel@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-12T00:00:00Z"), endAt: new Date("2099-02-12T00:30:00Z"), status: "CONFIRMED", calendarProviderSnapshot: "provider_recovery_required", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-12T00:00:00Z"),
      occupancies: { create: { workspaceId: event.workspaceId, hostId: event.ownerId, minuteStart: new Date("2099-02-12T00:00:00Z") } },
      outboxEffects: { create: { workspaceId: event.workspaceId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:pre-upgrade` } },
    } });
    await cancelBooking(bookingId, "Upgrade reconciliation cancellation");
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", externalCalendarEventId: null, notificationStatus: "RETRY_PENDING" });
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey: `calendar:delete:${bookingId}` } })).toMatchObject({ status: "RETRY" });
    process.env.GOOGLE_CLIENT_ID = "test-client"; process.env.GOOGLE_CLIENT_SECRET = "test-secret"; process.env.GOOGLE_REFRESH_TOKEN = "test-refresh"; process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = event.workspaceId;
    await db.integrationOutbox.update({ where: { idempotencyKey: `calendar:delete:${bookingId}` }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { creates += 1; throw new Error("create must stay blocked"); }, async updateBookingEvent() { throw new Error("update must stay blocked"); }, async deleteBookingEvent(booking) { deletes += 1; expect(booking.externalCalendarEventId).toBe(deterministicId); return { eventId: deterministicId, providerAbsent: false }; } };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(deletes).toBe(1);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", externalCalendarEventId: null, notificationStatus: "GOOGLE_UPDATE_ACCEPTED" });
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey: `calendar:delete:${bookingId}` } })).toMatchObject({ status: "COMPLETED" });
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey: `calendar:create:${bookingId}:pre-upgrade` } })).toMatchObject({ status: "COMPLETED", lastErrorCode: "SUPERSEDED_BY_RECOVERY_DELETE" });
    expect((await processOutbox(event.workspaceId, bookingId, new Date("2099-12-31T00:00:00Z"), calendar)).attempted).toBe(0);
    expect(creates).toBe(0); expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).notificationStatus).toBe("GOOGLE_UPDATE_ACCEPTED");
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("keeps sentinel delete and predecessor create retryable when the deterministic event is absent", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const deterministicId = providerCalendarEventId(bookingId);
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Upgrade Absent", inviteeEmail: "upgrade-absent@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-13T00:00:00Z"), endAt: new Date("2099-02-13T00:30:00Z"), status: "CANCELLED", calendarProviderSnapshot: "provider_recovery_required", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-13T00:00:00Z"),
    } });
    await db.integrationOutbox.createMany({ data: [
      { workspaceId: event.workspaceId, bookingId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:absent`, status: "RETRY", nextAttemptAt: new Date("2099-12-31T00:00:00Z") },
      { workspaceId: event.workspaceId, bookingId, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete:${bookingId}:absent` },
    ] });
    process.env.GOOGLE_CLIENT_ID = "test-client"; process.env.GOOGLE_CLIENT_SECRET = "test-secret"; process.env.GOOGLE_REFRESH_TOKEN = "test-refresh"; process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = event.workspaceId;
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { throw new Error("create must stay blocked"); }, async updateBookingEvent() { throw new Error("update must stay blocked"); }, async deleteBookingEvent(booking) { expect(booking.externalCalendarEventId).toBe(deterministicId); return { eventId: deterministicId, providerAbsent: true }; } };
    await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: deterministicId, notificationStatus: "RETRY_PENDING" });
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey: `calendar:delete:${bookingId}:absent` } })).toMatchObject({ status: "RETRY", lastErrorCode: "PROVIDER_OPERATION_FAILED" });
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey: `calendar:create:${bookingId}:absent` } })).toMatchObject({ status: "RETRY", lastErrorCode: null });
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("rejects a poisoned create's late catch after recovery delete supersedes its lease", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const deterministicId = providerCalendarEventId(bookingId); const poisonLease = "poisoned-create-worker";
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Late Catch", inviteeEmail: "late-catch@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-02-14T00:00:00Z"), endAt: new Date("2099-02-14T00:30:00Z"), status: "CANCELLED", calendarProviderSnapshot: "provider_recovery_required", externalCalendarEventId: deterministicId, notificationStatus: "PENDING", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-03-14T00:00:00Z"),
    } });
    const poisoned = await db.integrationOutbox.create({ data: { workspaceId: event.workspaceId, bookingId, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${bookingId}:poisoned`, status: "PROCESSING", leaseToken: poisonLease, leaseExpiresAt: new Date("2099-12-31T00:00:00Z"), attemptCount: 1 } });
    await db.integrationOutbox.create({ data: { workspaceId: event.workspaceId, bookingId, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete:${bookingId}:recovery` } });
    process.env.GOOGLE_CLIENT_ID = "test-client"; process.env.GOOGLE_CLIENT_SECRET = "test-secret"; process.env.GOOGLE_REFRESH_TOKEN = "test-refresh"; process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = event.workspaceId;
    const calendar: CalendarService = { async getBusyIntervals() { return []; }, async createBookingEvent() { throw new Error("poisoned create must not resume"); }, async updateBookingEvent() {}, async deleteBookingEvent() { return { eventId: deterministicId, providerAbsent: false }; } };
    const recovery = await processOutbox(event.workspaceId, bookingId, new Date(), calendar);
    expect(recovery.pending).toBe(0);
    expect(await recordOutboxRetry(poisoned, event.workspaceId, poisonLease, 0, new Date())).toBe(false);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ externalCalendarEventId: null, notificationStatus: "GOOGLE_UPDATE_ACCEPTED" });
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { id: poisoned.id } })).toMatchObject({ status: "COMPLETED", lastErrorCode: "SUPERSEDED_BY_RECOVERY_DELETE" });
    expect(await db.integrationOutbox.count({ where: { bookingId, status: { in: ["PENDING", "RETRY", "PROCESSING"] } } })).toBe(0);
    await db.booking.delete({ where: { id: bookingId } });
  });
});
