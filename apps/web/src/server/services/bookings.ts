import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { BookingManageCapabilities, CreateBookingInput, CreateBookingResult, ResumeBookingCheckoutResult } from "@/lib/contracts";
import { capabilityRows, materializeCapabilities, newCapabilityIdentity } from "@/server/auth/capabilities";
import { db } from "@/server/db";
import { AppError, conflict, notFound } from "@/server/errors";
import { mapBooking } from "@/server/mappers";
import { generateSlots, getAvailability } from "@/server/services/availability";
import { getCalendarService, providerCalendarEventId, type CalendarService } from "@/server/services/calendar";
import { getEventTypeBySlug, getEventTypeForSlotsBySlug } from "@/server/services/event-types";
import { currentDatabaseContext, enterDatabaseAction, enterDatabaseContext, enterPublicBookingDatabaseContext, enterPublicDatabaseContext } from "@/server/db-context";
import { processBookingOutbox } from "@/server/services/outbox";
import { shouldDrainOutboxInline } from "@/server/services/outbox-dispatch";
import { getPaymentService, type PaymentService } from "@/server/services/payments";
import { enqueueBookingEmail } from "@/server/services/notifications";
import { boundedPrismaTransactionOptions, withDatabaseTransactionRetry } from "@/server/database-retry";

const activeStatuses = ["CONFIRMED", "PENDING_PAYMENT"];
function providerErrorCode(error: unknown) { return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : ""; }
const MAX_VALIDATED_BOOKING_BUFFER_MINUTES = 240;
const bookingInclude = { eventType: { select: { name: true } }, host: { select: { name: true } }, answers: true } as const;
export type InternalCreateBookingResult = { booking: ReturnType<typeof mapBooking>; checkoutUrl: string | null; checkoutState: CreateBookingResult["checkoutState"]; manageCapabilities: BookingManageCapabilities | null };

export async function listBookings(workspaceId: string) {
  return (await db.booking.findMany({ where: { workspaceId }, include: bookingInclude, orderBy: { startAt: "asc" } })).map(mapBooking);
}

export async function getBookingForHost(workspaceId: string, id: string) {
  const booking = await db.booking.findFirst({ where: { id, workspaceId }, include: bookingInclude });
  if (!booking) throw notFound("Booking");
  return mapBooking(booking);
}

export async function getBookingDetail(id: string) {
  const booking = await db.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw notFound("Booking");
  return mapBooking(booking);
}

export async function listManageRescheduleSlots(id: string, from: Date, to: Date, outputTimeZone: string, durationId?: string, calendar: CalendarService = getCalendarService()) {
  const booking = await db.booking.findUnique({ where: { id }, include: { eventType: { select: { slug: true } } } });
  if (!booking || booking.status !== "CONFIRMED") throw notFound("Booking");
  if (booking.calendarProviderSnapshot === "provider_recovery_required") throw new AppError("CALENDAR_PROVIDER_RECOVERY_REQUIRED", "Reconcile this upgraded booking's calendar provider before rescheduling.", 503);
  const providerEventId = booking.externalCalendarEventId ?? (booking.calendarProviderSnapshot === "google" ? providerCalendarEventId(booking.id) : undefined);
  const slots = await listPublicSlots(booking.eventType.slug, from, to, outputTimeZone, calendar, durationId ?? booking.durationId ?? undefined, id, true, true, providerEventId, booking.bookingWindowDays, booking.durationMinutes, booking.bufferBeforeMinutes, booking.bufferAfterMinutes, booking.calendarProviderSnapshot === "google" ? "google" : "local");
  return slots.filter((slot) => new Date(slot.start).getTime() !== booking.startAt.getTime());
}

export async function listPublicSlots(slug: string, from: Date, to: Date, outputTimeZone: string, calendar: CalendarService = getCalendarService(), durationId?: string, excludeBookingId?: string, allowInactiveDuration = false, allowInactiveEvent = false, excludeProviderEventId?: string, bookingWindowDaysOverride?: number, durationMinutesOverride?: number, bufferBeforeOverride?: number, bufferAfterOverride?: number, busyProviderOverride?: "google" | "local") {
  const eventType = await getEventTypeForSlotsBySlug(slug, !allowInactiveEvent);
  const duration = (durationId ? eventType.durations.find((item) => item.id === durationId) : eventType.durations.find((item) => item.isDefault))
    ?? (durationId && allowInactiveDuration ? await db.eventDuration.findFirst({ where: { id: durationId, eventTypeId: eventType.id } }) : null);
  if (!duration) throw notFound("Duration option");
  const effectiveBufferBefore = bufferBeforeOverride ?? eventType.bufferBeforeMinutes; const effectiveBufferAfter = bufferAfterOverride ?? eventType.bufferAfterMinutes;
  const providerFrom = DateTime.fromJSDate(from).minus({ minutes: effectiveBufferBefore }).toJSDate();
  const providerTo = DateTime.fromJSDate(to).plus({ minutes: effectiveBufferAfter }).toJSDate();
  const providerBusyRequest = async () => {
    // Promise branches get their own signed public context so another contextual
    // Prisma transaction cannot leave provider readiness workspace-less.
    enterPublicDatabaseContext(slug, eventType.workspaceId, eventType.id);
    return (excludeProviderEventId || busyProviderOverride) && calendar.getBusyIntervalsExcludingEvent
      ? calendar.getBusyIntervalsExcludingEvent(eventType.ownerId, providerFrom, providerTo, excludeProviderEventId ?? "__tempocove_no_excluded_event__", busyProviderOverride, eventType.workspaceId)
      : calendar.getBusyIntervals(eventType.ownerId, providerFrom, providerTo, eventType.workspaceId);
  };
  const bookingRangeStart = DateTime.fromJSDate(from).minus({ minutes: effectiveBufferBefore + MAX_VALIDATED_BOOKING_BUFFER_MINUTES }).toJSDate();
  const bookingRangeEnd = DateTime.fromJSDate(to).plus({ minutes: effectiveBufferAfter + MAX_VALIDATED_BOOKING_BUFFER_MINUTES }).toJSDate();
  const [schedule, bookings, providerBusy] = await Promise.all([
    getAvailability(eventType.workspaceId, eventType.ownerId, eventType.owner.timeZone, { from, to }),
    db.booking.findMany({
      where: { id: excludeBookingId ? { not: excludeBookingId } : undefined, workspaceId: eventType.workspaceId, hostId: eventType.ownerId, status: { in: activeStatuses }, startAt: { lt: bookingRangeEnd }, endAt: { gt: bookingRangeStart } },
      select: { startAt: true, endAt: true, bufferBeforeMinutes: true, bufferAfterMinutes: true },
    }),
    providerBusyRequest(),
  ]);
  return generateSlots({
    eventType: { ...eventType, bookingWindowDays: bookingWindowDaysOverride ?? eventType.bookingWindowDays, durationId: duration.id, durationMinutes: durationMinutesOverride ?? duration.durationMinutes, bufferBeforeMinutes: effectiveBufferBefore, bufferAfterMinutes: effectiveBufferAfter, priceCents: duration.priceCents, currency: duration.currency },
    schedule,
    busy: [
      ...bookings.map((item) => ({
        start: DateTime.fromJSDate(item.startAt).minus({ minutes: item.bufferBeforeMinutes }).toJSDate(),
        end: DateTime.fromJSDate(item.endAt).plus({ minutes: item.bufferAfterMinutes }).toJSDate(),
      })),
      ...providerBusy,
    ],
    from, to, outputTimeZone,
  });
}

export function occupiedMinutes(start: Date, end: Date, beforeMinutes: number, afterMinutes: number) {
  const first = DateTime.fromJSDate(start).minus({ minutes: beforeMinutes }).startOf("minute");
  const last = DateTime.fromJSDate(end).plus({ minutes: afterMinutes }).startOf("minute");
  const minutes: Date[] = [];
  for (let cursor = first; cursor < last; cursor = cursor.plus({ minutes: 1 })) minutes.push(cursor.toJSDate());
  return minutes;
}

async function priorResult(slug: string, idempotencyKey: string, requestFingerprint: string): Promise<InternalCreateBookingResult | null> {
  const prior = await db.booking.findFirst({ where: { idempotencyKey, eventType: { slug } }, include: bookingInclude });
  if (!prior) return null;
  if (prior.requestFingerprint !== requestFingerprint) throw conflict("That idempotency key was already used for a different booking request.");
  const activeCapabilities = await db.bookingCapability.count({ where: { bookingId: prior.id, revokedAt: null, expiresAt: { gt: new Date() } } });
  return { booking: mapBooking(prior), checkoutUrl: prior.stripeCheckoutUrl, checkoutState: prior.priceCents === 0 ? "NOT_REQUIRED" : prior.stripeCheckoutUrl ? "READY" : "RETRY_REQUIRED", manageCapabilities: activeCapabilities === 3 ? materializeCapabilities(prior.id, prior.capabilityVersion, prior.manageExpiresAt, prior.capabilityKeyId) : null };
}

async function ensureCheckoutLinked(bookingId: string, payments: PaymentService) {
  const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { eventType: true } });
  if (!booking.priceCents || booking.stripeCheckoutSessionId) return booking.stripeCheckoutUrl;
  const checkout = await payments.createCheckout(booking, booking.eventType);
  if (!checkout) throw new Error("PAID_CHECKOUT_UNAVAILABLE");
  if (process.env.DATABASE_PROVIDER === "postgresql" && process.env.NODE_ENV === "production") {
    const rows = await db.$queryRawUnsafe<Array<{ linked: boolean }>>("SELECT tempocove_link_checkout($1::text,$2::text,$3::text) AS linked", booking.id, checkout.sessionId, checkout.url);
    if (rows[0]?.linked) return checkout.url;
  } else {
    const linked = await db.booking.updateMany({ where: { id: booking.id, stripeCheckoutSessionId: null, status: "PENDING_PAYMENT" }, data: { stripeCheckoutSessionId: checkout.sessionId, stripeCheckoutUrl: checkout.url, stripePaymentStatus: "unpaid" } });
    if (linked.count === 1) return checkout.url;
  }
  return (await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).stripeCheckoutUrl;
}

export async function createBooking(
  slug: string, input: CreateBookingInput, idempotencyKey: string,
  calendar: CalendarService = getCalendarService(), payments: PaymentService = getPaymentService(),
): Promise<InternalCreateBookingResult> {
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ slug, ...input })).digest("hex");
  const eventType = await withDatabaseTransactionRetry(() => getEventTypeBySlug(slug));
  enterPublicBookingDatabaseContext(eventType.id, eventType.workspaceId, idempotencyKey);
  const prior = await withDatabaseTransactionRetry(() => priorResult(slug, idempotencyKey, requestFingerprint));
  if (prior) {
    if (prior.booking.priceCents > 0 && !prior.checkoutUrl && prior.booking.status === "PENDING_PAYMENT") {
      try { prior.checkoutUrl = await ensureCheckoutLinked(prior.booking.id, payments); prior.checkoutState = prior.checkoutUrl ? "READY" : "RETRY_REQUIRED"; }
      catch { prior.checkoutState = "RETRY_REQUIRED"; await db.booking.updateMany({ where: { id: prior.booking.id, status: "PENDING_PAYMENT" }, data: { stripePaymentStatus: "checkout_retry" } }); }
    }
    return prior;
  }
  const duration = input.durationId ? eventType.durations.find((item) => item.id === input.durationId) : eventType.durations.find((item) => item.isDefault);
  if (!duration) throw notFound("Duration option");
  const answerMap = new Map((input.answers ?? []).map((answer) => [answer.questionId, answer.value]));
  for (const question of eventType.questions) {
    const value = answerMap.get(question.id);
    if (question.required && (!answerMap.has(question.id) || value == null || value === "")) throw conflict(`Answer required: ${question.label}`);
    if (!answerMap.has(question.id)) continue;
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, "utf8") > 4000) throw conflict(`Answer is invalid: ${question.label}`);
    if (question.kind === "CHECKBOX" && typeof value !== "boolean") throw conflict(`Answer must be checked or unchecked: ${question.label}`);
    if (question.kind === "SELECT" && (typeof value !== "string" || !((question.optionsJson ? JSON.parse(question.optionsJson) as string[] : []).includes(value)))) throw conflict(`Choose a valid option: ${question.label}`);
  }
  if ([...answerMap.keys()].some((id) => !eventType.questions.some((question) => question.id === id))) throw conflict("A booking answer does not belong to this event type.");
  const requestedStart = new Date(input.startAt);
  const requestedEnd = DateTime.fromJSDate(requestedStart).plus({ minutes: duration.durationMinutes }).toJSDate();
  const windowStart = DateTime.fromJSDate(requestedStart).startOf("day").minus({ hours: 14 }).toJSDate();
  const windowEnd = DateTime.fromJSDate(requestedStart).endOf("day").plus({ hours: 14 }).toJSDate();
  const slots = await withDatabaseTransactionRetry(() => listPublicSlots(slug, windowStart, windowEnd, input.inviteeTimeZone, calendar, duration.id));
  if (!slots.some((slot) => new Date(slot.start).getTime() === requestedStart.getTime())) throw conflict("That time is no longer available.");
  enterPublicBookingDatabaseContext(eventType.id, eventType.workspaceId, idempotencyKey);
  const capability = newCapabilityIdentity(requestedEnd);
  const calendarProviderSnapshot = await calendar.providerKind?.(eventType.ownerId, eventType.workspaceId) ?? "local";
  let created;
  try {
    created = await withDatabaseTransactionRetry((remainingMs) => db.$transaction(async (tx) => {
      const booking = await tx.booking.create({ data: {
        workspaceId: eventType.workspaceId, eventTypeId: eventType.id, hostId: eventType.ownerId, durationId: duration.id,
        durationMinutes: duration.durationMinutes, priceCents: duration.priceCents, currency: duration.currency,
        bufferBeforeMinutes: eventType.bufferBeforeMinutes, bufferAfterMinutes: eventType.bufferAfterMinutes,
        bookingWindowDays: eventType.bookingWindowDays,
        inviteeName: input.inviteeName, inviteeEmail: input.inviteeEmail, inviteeTimeZone: input.inviteeTimeZone,
        startAt: requestedStart, endAt: requestedEnd, notes: input.notes || null,
        eventTitleSnapshot: eventType.name, locationTypeSnapshot: eventType.locationType,
        locationValueSnapshot: eventType.locationValue, calendarProviderSnapshot,
        idempotencyKey, requestFingerprint, capabilityVersion: capability.version, capabilityKeyId: capability.keyId, manageExpiresAt: capability.expiresAt,
        status: duration.priceCents > 0 ? "PENDING_PAYMENT" : "CONFIRMED",
        checkoutResumeExpiresAt: duration.priceCents > 0 ? new Date(Date.now() + 24 * 60 * 60_000) : null,
        calendarSyncStatus: duration.priceCents > 0 ? "LOCAL" : "PENDING",
        notificationStatus: duration.priceCents > 0 ? "LOCAL_NO_EMAIL" : "PENDING",
        answers: { create: eventType.questions.filter((item) => answerMap.has(item.id)).map((item) => ({ questionId: item.id, questionLabel: item.label, valueJson: JSON.stringify(answerMap.get(item.id)) })) },
      } });
      await tx.bookingOccupancy.createMany({ data: occupiedMinutes(requestedStart, requestedEnd, eventType.bufferBeforeMinutes, eventType.bufferAfterMinutes).map((minuteStart) => ({ workspaceId: eventType.workspaceId, bookingId: booking.id, hostId: eventType.ownerId, minuteStart })) });
      await tx.bookingCapability.createMany({ data: capabilityRows(booking.id, capability.version, capability.expiresAt, capability.keyId) });
      if (!duration.priceCents) {
        await tx.integrationOutbox.create({ data: { workspaceId: eventType.workspaceId, bookingId: booking.id, kind: "CALENDAR_CREATE", idempotencyKey: `calendar:create:${booking.id}:free` } });
        await enqueueBookingEmail(tx, booking, "BOOKING_CONFIRMED");
      }
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
    }, boundedPrismaTransactionOptions(remainingMs)));
  } catch (error) {
    // SQLite and PostgreSQL use separately generated Prisma clients, so
    // cross-client `instanceof` is not a valid production error discriminator.
    if (providerErrorCode(error) === "P2002") {
      const winner = await withDatabaseTransactionRetry(() => priorResult(slug, idempotencyKey, requestFingerprint));
      if (winner) return winner;
      throw conflict("That time was just booked. Choose another slot.");
    }
    throw error;
  }
  let checkoutUrl: string | null = null;
  let checkoutState: InternalCreateBookingResult["checkoutState"] = created.priceCents > 0 ? "RETRY_REQUIRED" : "NOT_REQUIRED";
  if (created.priceCents > 0) {
    try {
      checkoutUrl = await ensureCheckoutLinked(created.id, payments);
      checkoutState = checkoutUrl ? "READY" : "RETRY_REQUIRED";
    } catch {
      await db.booking.update({ where: { id: created.id }, data: { stripePaymentStatus: "checkout_retry" } });
    }
  } else if (shouldDrainOutboxInline()) await processBookingOutbox(created.id);
  return { booking: mapBooking(created), checkoutUrl, checkoutState, manageCapabilities: materializeCapabilities(created.id, capability.version, capability.expiresAt, capability.keyId) };
}

export async function resumeBookingCheckout(id: string, payments: PaymentService = getPaymentService()): Promise<ResumeBookingCheckoutResult> {
  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) throw notFound("Booking");
  if (booking.status !== "PENDING_PAYMENT" || booking.priceCents <= 0) return { bookingId: booking.id, status: booking.status as ResumeBookingCheckoutResult["status"], checkoutState: "NOT_REQUIRED", checkoutUrl: null };
  if (!booking.checkoutResumeExpiresAt || booking.checkoutResumeExpiresAt.getTime() - Date.now() < 30 * 60_000) throw new AppError("CHECKOUT_RESUME_EXPIRED", "This payment attempt can no longer be resumed. Cancel it or create a new booking.", 409);
  if (booking.stripeCheckoutUrl) return { bookingId: booking.id, status: "PENDING_PAYMENT", checkoutState: "READY", checkoutUrl: booking.stripeCheckoutUrl };
  try {
    const checkoutUrl = await ensureCheckoutLinked(booking.id, payments);
    if (checkoutUrl) return { bookingId: booking.id, status: "PENDING_PAYMENT", checkoutState: "READY", checkoutUrl };
  } catch { await db.booking.updateMany({ where: { id: booking.id, status: "PENDING_PAYMENT" }, data: { stripePaymentStatus: "checkout_retry" } }); }
  return { bookingId: booking.id, status: "PENDING_PAYMENT", checkoutState: "RETRY_REQUIRED", checkoutUrl: null };
}

export async function cancelBooking(id: string, cancellationReason?: string) {
  enterDatabaseAction("booking_write");
  const current = await db.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!current) throw notFound("Booking");
  if (current.status === "CANCELLED") return mapBooking(current);
  const updated = await db.$transaction(async (tx) => {
    const mutationNow = new Date();
    const won = await tx.booking.updateMany({ where: { id, mutationVersion: current.mutationVersion, status: { not: "CANCELLED" }, OR: [{ calendarLeaseToken: null }, { calendarLeaseExpiresAt: { lte: mutationNow } }] }, data: { status: "CANCELLED", mutationVersion: { increment: 1 }, calendarLeaseToken: null, calendarLeaseExpiresAt: null, cancellationReason: cancellationReason?.trim() || "INVITEE_CANCELLED", calendarSyncStatus: "PENDING", notificationStatus: "PENDING" } });
    if (won.count !== 1) throw conflict("The booking changed while cancellation was being applied. Refresh and try again.");
    await tx.bookingOccupancy.deleteMany({ where: { bookingId: id } });
    await tx.bookingCapability.updateMany({ where: { bookingId: id, scope: { in: ["cancel", "reschedule"] }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.bookingManageSession.updateMany({ where: { bookingId: id, revokedAt: null }, data: { scopes: "read" } });
    await tx.integrationOutbox.upsert({ where: { idempotencyKey: `calendar:delete:${id}` }, update: {}, create: { workspaceId: current.workspaceId, bookingId: id, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete:${id}` } });
    const result = await tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
    if (result.stripePaymentStatus === "paid" || result.stripePaymentStatus === "paid_after_cancel") {
      if (!result.stripePaymentIntentId) throw new Error("STRIPE_REFUND_AUTHORITY_REQUIRED");
      await tx.booking.update({ where: { id }, data: { refundStatus: "REFUND_PENDING", refundFailureCode: null } });
      await tx.integrationOutbox.upsert({ where: { idempotencyKey: `stripe:refund:${id}:full:v1` }, update: {}, create: { workspaceId: result.workspaceId, bookingId: id, kind: "STRIPE_REFUND", idempotencyKey: `stripe:refund:${id}:full:v1` } });
    } else if (result.stripeCheckoutSessionId) await tx.integrationOutbox.upsert({ where: { idempotencyKey: `stripe:expire:${id}` }, update: {}, create: { workspaceId: result.workspaceId, bookingId: id, kind: "STRIPE_EXPIRE", idempotencyKey: `stripe:expire:${id}` } });
    const finalResult = await tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
    await enqueueBookingEmail(tx, finalResult, "BOOKING_CANCELLED", mutationNow); return finalResult;
  });
  if (shouldDrainOutboxInline()) await processBookingOutbox(id);
  return mapBooking(updated);
}

export async function rescheduleBooking(id: string, startAt: string, calendar: CalendarService = getCalendarService()) {
  enterDatabaseAction("booking_write");
  const mutationContext = currentDatabaseContext();
  const booking = await db.booking.findUnique({ where: { id }, include: { eventType: { include: { durations: true, questions: true } }, host: true } });
  if (!booking || booking.status !== "CONFIRMED") throw notFound("Booking");
  if (booking.calendarProviderSnapshot === "provider_recovery_required") throw new AppError("CALENDAR_PROVIDER_RECOVERY_REQUIRED", "Reconcile this upgraded booking's calendar provider before rescheduling.", 503);
  const requestedStart = new Date(startAt);
  if (requestedStart.getTime() === booking.startAt.getTime()) return mapBooking(await db.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude }));
  const requestedEnd = DateTime.fromJSDate(requestedStart).plus({ minutes: booking.durationMinutes }).toJSDate();
  const renewedManageExpiry = new Date(requestedEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
  const rangeStart = DateTime.fromJSDate(requestedStart).startOf("day").minus({ hours: 14 }).toJSDate();
  const rangeEnd = DateTime.fromJSDate(requestedStart).endOf("day").plus({ hours: 14 }).toJSDate();
  const providerEventId = booking.externalCalendarEventId ?? (booking.calendarProviderSnapshot === "google" ? providerCalendarEventId(booking.id) : undefined);
  const slots = await listPublicSlots(booking.eventType.slug, rangeStart, rangeEnd, booking.inviteeTimeZone, calendar, booking.durationId ?? undefined, id, true, true, providerEventId, booking.bookingWindowDays, booking.durationMinutes, booking.bufferBeforeMinutes, booking.bufferAfterMinutes, booking.calendarProviderSnapshot === "google" ? "google" : "local");
  if (!slots.some((slot) => new Date(slot.start).getTime() === requestedStart.getTime())) throw conflict("That time is no longer available.");
  if (mutationContext) enterDatabaseContext({ ...mutationContext, action: "booking_write" });
  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      const mutationNow = new Date();
      const won = await tx.booking.updateMany({ where: { id, mutationVersion: booking.mutationVersion, status: "CONFIRMED", OR: [{ calendarLeaseToken: null }, { calendarLeaseExpiresAt: { lte: mutationNow } }] }, data: { startAt: requestedStart, endAt: requestedEnd, manageExpiresAt: renewedManageExpiry, mutationVersion: { increment: 1 }, calendarLeaseToken: null, calendarLeaseExpiresAt: null, calendarSyncStatus: "PENDING", notificationStatus: "PENDING" } });
      if (won.count !== 1) throw conflict("The booking changed while rescheduling. Refresh and choose a new time.");
      await tx.bookingOccupancy.deleteMany({ where: { bookingId: id } });
      await tx.bookingOccupancy.createMany({ data: occupiedMinutes(requestedStart, requestedEnd, booking.bufferBeforeMinutes, booking.bufferAfterMinutes).map((minuteStart) => ({ workspaceId: booking.workspaceId, bookingId: id, hostId: booking.hostId, minuteStart })) });
      await tx.bookingManageSession.updateMany({ where: { bookingId: id, revokedAt: null }, data: { expiresAt: renewedManageExpiry } });
      await tx.integrationOutbox.create({ data: { workspaceId: booking.workspaceId, bookingId: id, kind: "CALENDAR_UPDATE", bookingMutationVersion: booking.mutationVersion + 1, idempotencyKey: `calendar:update:${id}:${requestedStart.toISOString()}` } });
      const result = await tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
      await enqueueBookingEmail(tx, result, "BOOKING_RESCHEDULED", mutationNow); return result;
    });
  } catch (error) {
    if (providerErrorCode(error) === "P2002") throw conflict("That time was just booked. Choose another slot.");
    throw error;
  }
  if (shouldDrainOutboxInline()) await processBookingOutbox(id);
  return mapBooking(updated);
}
