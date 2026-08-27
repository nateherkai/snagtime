import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { CALENDAR_PROVIDER_TIMEOUT_MS, getCalendarService, googleCredentialsReady, providerCalendarEventId, type CalendarService } from "@/server/services/calendar";
import { retryPendingGoogleDisconnects } from "@/server/services/calendar";
import { getPaymentService, type PaymentService } from "@/server/services/payments";

export const CALENDAR_LEASE_MS = 120_000;
export const INTEGRATION_MAX_ATTEMPTS = 12;
const workerBookingInclude = { eventType: true, host: { select: { id: true, name: true, email: true, timeZone: true } } } as const;

function assertWorkerRunning(signal?: AbortSignal) { if (signal?.aborted) throw new Error("OUTBOX_WORKER_STOPPING"); }

export async function withProviderDeadline<T>(operation: Promise<T>, timeoutMs = CALENDAR_PROVIDER_TIMEOUT_MS) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CALENDAR_PROVIDER_TIMEOUT")), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function renewCalendarLease(bookingId: string, mutationVersion: number, leaseToken: string) {
  const heartbeatAt = new Date(); const leaseExpiresAt = new Date(heartbeatAt.getTime() + CALENDAR_LEASE_MS);
  const renewed = await db.booking.updateMany({ where: { id: bookingId, mutationVersion, calendarLeaseToken: leaseToken, calendarLeaseExpiresAt: { gt: heartbeatAt } }, data: { calendarLeaseExpiresAt: leaseExpiresAt } });
  if (renewed.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
  return leaseExpiresAt;
}

type RetryableEffect = { id: string; bookingId: string; kind: string; attemptCount: number };
async function releaseOutboxClaimForShutdown(effectId: string, leaseToken: string, bookingId?: string, bookingVersion?: number) {
  await db.$transaction(async(tx)=>{const released=await tx.integrationOutbox.updateMany({ where: { id: effectId, status: "PROCESSING", leaseToken }, data: { status: "RETRY", attemptCount: { decrement: 1 }, nextAttemptAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastErrorCode: "WORKER_STOPPED" } });if(released.count===1&&bookingId&&bookingVersion!==undefined)await tx.booking.updateMany({where:{id:bookingId,mutationVersion:bookingVersion,calendarLeaseToken:leaseToken},data:{calendarLeaseToken:null,calendarLeaseExpiresAt:null}});});
}
export async function recordOutboxRetry(effect: RetryableEffect, workspaceId: string, leaseToken: string, bookingVersion: number | undefined, now: Date) {
  const delayMinutes = Math.min(60, 2 ** Math.min(effect.attemptCount, 5));
  return db.$transaction(async (tx) => {
    const terminal = effect.attemptCount + 1 >= INTEGRATION_MAX_ATTEMPTS;
    const retried = await tx.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: terminal ? "DEAD" : "RETRY", lastErrorCode: "PROVIDER_OPERATION_FAILED", nextAttemptAt: terminal ? now : new Date(now.getTime() + delayMinutes * 60_000), leaseToken: null, leaseExpiresAt: null } });
    if (retried.count !== 1) return false;
    if (effect.kind.startsWith("CALENDAR_") && bookingVersion !== undefined) {
      await tx.booking.updateMany({ where: { id: effect.bookingId, workspaceId, mutationVersion: bookingVersion, OR: [{ calendarLeaseToken: leaseToken }, { calendarLeaseToken: null }] }, data: { calendarLeaseToken: null, calendarLeaseExpiresAt: null, notificationStatus: "RETRY_PENDING" } });
    }
    return true;
  });
}

export async function processOutbox(workspaceId: string, bookingId?: string, now = new Date(), calendar: CalendarService = getCalendarService(), payments: PaymentService = getPaymentService(), signal?: AbortSignal) {
  const effects = await db.integrationOutbox.findMany({
    where: {
      bookingId, workspaceId,
      OR: [
        { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" }, take: 20,
  });
  let attempted = 0;
  for (const effect of effects) {
    if (signal?.aborted) break;
    const leaseToken = randomBytes(18).toString("base64url"); const leaseStartedAt = new Date(); const leaseExpiresAt = new Date(leaseStartedAt.getTime() + CALENDAR_LEASE_MS);
    const claimed = await db.integrationOutbox.updateMany({
      where: { id: effect.id, workspaceId, OR: [
        { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } },
      ] },
      data: { status: "PROCESSING", leaseToken, leaseExpiresAt, attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    if (signal?.aborted) { await releaseOutboxClaimForShutdown(effect.id, leaseToken); break; }
    attempted += 1;
    let claimedBookingVersion: number | undefined;
    try {
      const booking = await db.booking.findFirstOrThrow({ where: { id: effect.bookingId, workspaceId }, include: workerBookingInclude });
      claimedBookingVersion = booking.mutationVersion;
      if (booking.calendarProviderSnapshot === "provider_recovery_required") {
        if (effect.kind !== "CALENDAR_DELETE") throw new Error("CALENDAR_PROVIDER_RECOVERY_REQUIRED");
        assertWorkerRunning(signal);
        if (!await googleCredentialsReady(booking.hostId, booking.workspaceId)) throw new Error("GOOGLE_CALENDAR_RETRY");
      }
      if (effect.kind === "CALENDAR_CREATE") {
        if (booking.status === "CANCELLED") {
          assertWorkerRunning(signal);
          const candidateEventId = booking.externalCalendarEventId || await calendar.candidateEventId?.(booking)
            || (booking.calendarProviderSnapshot === "google" ? providerCalendarEventId(booking.id) : null);
          if (candidateEventId) await db.$transaction(async (tx) => {
            await tx.booking.update({ where: { id: booking.id }, data: { externalCalendarEventId: candidateEventId, calendarSyncStatus: "PENDING", notificationStatus: "PENDING" } });
            await tx.integrationOutbox.upsert({ where: { idempotencyKey: `calendar:delete-tombstone:${booking.id}:${candidateEventId}` }, update: {}, create: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_DELETE", idempotencyKey: `calendar:delete-tombstone:${booking.id}:${candidateEventId}` } });
          });
          else await db.booking.update({ where: { id: booking.id }, data: { calendarSyncStatus: "LOCAL", notificationStatus: "LOCAL_NO_EMAIL" } });
          await db.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: null, leaseToken: null, leaseExpiresAt: null } });
          continue;
        }
        const lifecycleLease = await db.booking.updateMany({ where: {
          id: booking.id, status: { not: "CANCELLED" }, mutationVersion: booking.mutationVersion,
          OR: [{ calendarLeaseToken: null }, { calendarLeaseExpiresAt: { lte: leaseStartedAt } }],
        }, data: { calendarLeaseToken: leaseToken, calendarLeaseExpiresAt: leaseExpiresAt } });
        if (lifecycleLease.count !== 1) throw new Error("CALENDAR_LEASE_BUSY");
        await renewCalendarLease(booking.id, booking.mutationVersion, leaseToken);
        const active = await db.booking.findFirstOrThrow({ where: { id: booking.id, status: { not: "CANCELLED" }, mutationVersion: booking.mutationVersion, calendarLeaseToken: leaseToken }, include: workerBookingInclude });
        assertWorkerRunning(signal);
        const creation = await withProviderDeadline(calendar.createBookingEvent(active));
        const eventId = typeof creation === "string" ? creation : creation?.eventId ?? null;
        const eventEtag = typeof creation === "object" && creation ? creation.etag ?? null : null;
        if (!eventId) {
          const completed = await db.booking.updateMany({ where: { id: booking.id, status: { not: "CANCELLED" }, mutationVersion: booking.mutationVersion, calendarLeaseToken: leaseToken }, data: { calendarLeaseToken: null, calendarLeaseExpiresAt: null, calendarSyncStatus: "LOCAL", notificationStatus: "LOCAL_NO_EMAIL" } });
          if (completed.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
        }
        else {
          const attached = await db.booking.updateMany({ where: { id: booking.id, status: { not: "CANCELLED" }, mutationVersion: booking.mutationVersion, calendarLeaseToken: leaseToken }, data: { externalCalendarEventId: eventId, externalCalendarEventEtag: eventEtag, calendarLeaseToken: null, calendarLeaseExpiresAt: null, calendarSyncStatus: "SYNCED", notificationStatus: "GOOGLE_UPDATE_ACCEPTED" } });
          if (attached.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
        }
      } else if (effect.kind === "CALENDAR_UPDATE") {
        if (effect.bookingMutationVersion == null) {
          await db.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: "STALE_CALENDAR_UPDATE", leaseToken: null, leaseExpiresAt: null } });
          continue;
        }
        const lifecycleLease = await db.booking.updateMany({ where: {
          id: booking.id, status: "CONFIRMED", mutationVersion: effect.bookingMutationVersion,
          OR: [{ calendarLeaseToken: null }, { calendarLeaseExpiresAt: { lte: leaseStartedAt } }],
        }, data: { calendarLeaseToken: leaseToken, calendarLeaseExpiresAt: leaseExpiresAt } });
        if (lifecycleLease.count !== 1) {
          await db.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: "STALE_CALENDAR_UPDATE", leaseToken: null, leaseExpiresAt: null } });
          continue;
        }
        const active = await db.booking.findFirst({ where: { id: booking.id, status: "CONFIRMED", mutationVersion: effect.bookingMutationVersion, calendarLeaseToken: leaseToken }, include: workerBookingInclude });
        if (!active) {
          await db.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: "STALE_CALENDAR_UPDATE", leaseToken: null, leaseExpiresAt: null } });
          continue;
        }
        await renewCalendarLease(active.id, effect.bookingMutationVersion, leaseToken);
        assertWorkerRunning(signal);
        const mutation = await withProviderDeadline(calendar.updateBookingEvent(active));
        const mutationIdentity = mutation && typeof mutation === "object" && "eventId" in mutation ? mutation : null;
        const resolvedEventId = mutationIdentity?.eventId ?? active.externalCalendarEventId;
        if (active.calendarProviderSnapshot === "google" && !resolvedEventId) throw new Error("GOOGLE_EVENT_ID_REQUIRED");
        const completed = await db.booking.updateMany({ where: { id: active.id, status: "CONFIRMED", mutationVersion: effect.bookingMutationVersion, calendarLeaseToken: leaseToken }, data: {
          externalCalendarEventId: resolvedEventId, externalCalendarEventEtag: mutationIdentity?.etag ?? active.externalCalendarEventEtag,
          calendarLeaseToken: null, calendarLeaseExpiresAt: null, calendarSyncStatus: resolvedEventId ? "SYNCED" : "LOCAL", notificationStatus: resolvedEventId ? "GOOGLE_UPDATE_ACCEPTED" : "LOCAL_NO_EMAIL",
        } });
        if (completed.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
      } else if (effect.kind === "CALENDAR_DELETE") {
        const lifecycleLease = await db.booking.updateMany({ where: {
          id: booking.id, mutationVersion: booking.mutationVersion,
          OR: [{ calendarLeaseToken: null }, { calendarLeaseExpiresAt: { lte: leaseStartedAt } }],
        }, data: { calendarLeaseToken: leaseToken, calendarLeaseExpiresAt: leaseExpiresAt } });
        if (lifecycleLease.count !== 1) throw new Error("CALENDAR_LEASE_BUSY");
        await renewCalendarLease(booking.id, booking.mutationVersion, leaseToken);
        let active = await db.booking.findFirstOrThrow({ where: { id: booking.id, mutationVersion: booking.mutationVersion, calendarLeaseToken: leaseToken }, include: workerBookingInclude });
        assertWorkerRunning(signal);
        const deleteTarget = active.calendarProviderSnapshot === "provider_recovery_required"
          ? providerCalendarEventId(active.id)
          : active.externalCalendarEventId || await calendar.candidateEventId?.(active) || (active.calendarProviderSnapshot === "google" ? providerCalendarEventId(active.id) : null);
        if (deleteTarget && !active.externalCalendarEventId) {
          const persisted = await db.booking.updateMany({ where: { id: active.id, mutationVersion: active.mutationVersion, calendarLeaseToken: leaseToken, externalCalendarEventId: null }, data: { externalCalendarEventId: deleteTarget } });
          if (persisted.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
          active = { ...active, externalCalendarEventId: deleteTarget };
        }
        assertWorkerRunning(signal);
        const deletion = await withProviderDeadline(calendar.deleteBookingEvent(active));
        if ((active.calendarProviderSnapshot === "google" || active.calendarProviderSnapshot === "provider_recovery_required") && deletion && typeof deletion === "object" && deletion.providerAbsent) {
          throw new Error("GOOGLE_DELETE_AMBIGUITY_RETRY");
        }
        if (active.calendarProviderSnapshot === "provider_recovery_required") {
          await db.$transaction(async (tx) => {
            const completed = await tx.booking.updateMany({ where: { id: active.id, mutationVersion: active.mutationVersion, calendarLeaseToken: leaseToken }, data: { externalCalendarEventId: null, externalCalendarEventEtag: null, calendarLeaseToken: null, calendarLeaseExpiresAt: null, calendarSyncStatus: "LOCAL", notificationStatus: "GOOGLE_UPDATE_ACCEPTED" } });
            if (completed.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
            await tx.integrationOutbox.updateMany({ where: { bookingId: active.id, kind: "CALENDAR_CREATE", status: { in: ["PENDING", "RETRY", "PROCESSING"] } }, data: { status: "COMPLETED", lastErrorCode: "SUPERSEDED_BY_RECOVERY_DELETE", leaseToken: null, leaseExpiresAt: null } });
            const deleteCompleted = await tx.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: null, leaseToken: null, leaseExpiresAt: null } });
            if (deleteCompleted.count !== 1) throw new Error("CALENDAR_DELETE_FENCE_LOST");
          });
          continue;
        }
        const completed = await db.booking.updateMany({ where: { id: active.id, mutationVersion: active.mutationVersion, calendarLeaseToken: leaseToken }, data: { externalCalendarEventId: null, externalCalendarEventEtag: null, calendarLeaseToken: null, calendarLeaseExpiresAt: null, calendarSyncStatus: "LOCAL", notificationStatus: deleteTarget ? "GOOGLE_UPDATE_ACCEPTED" : "LOCAL_NO_EMAIL" } });
        if (completed.count !== 1) throw new Error("CALENDAR_LEASE_FENCE_LOST");
      } else if (effect.kind === "STRIPE_EXPIRE" && booking.stripeCheckoutSessionId) {
        assertWorkerRunning(signal);
        await payments.expireCheckout(booking.stripeCheckoutSessionId);
      } else if (effect.kind === "STRIPE_REFUND") {
        if (booking.refundStatus === "REFUNDED") {
          await db.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: null, leaseToken: null, leaseExpiresAt: null } });
          continue;
        }
        if (booking.status !== "CANCELLED" || !booking.stripePaymentIntentId || !["REFUND_PENDING", "REFUND_FAILED"].includes(booking.refundStatus)) throw new Error("STRIPE_REFUND_STATE_INVALID");
        assertWorkerRunning(signal);
        const refund = await withProviderDeadline(payments.refundPayment(booking));
        const updated = await db.booking.updateMany({ where: { id: booking.id, status: "CANCELLED", stripePaymentIntentId: booking.stripePaymentIntentId, refundStatus: { in: ["REFUND_PENDING", "REFUND_FAILED"] } }, data: {
          stripeRefundId: refund.refundId,
          refundStatus: refund.status === "succeeded" ? "REFUNDED" : refund.status === "failed" ? "REFUND_FAILED" : "REFUND_PENDING",
          refundedAmountCents: refund.status === "succeeded" ? booking.priceCents : booking.refundedAmountCents,
          refundFailureCode: refund.status === "failed" ? refund.failureCode ?? "PROVIDER_REFUND_FAILED" : null,
        } });
        if (updated.count !== 1) throw new Error("STRIPE_REFUND_FENCE_LOST");
        if (refund.status !== "succeeded") throw new Error(refund.status === "failed" ? "STRIPE_REFUND_FAILED" : "STRIPE_REFUND_PENDING");
      }
      await db.integrationOutbox.updateMany({ where: { id: effect.id, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", lastErrorCode: null, leaseToken: null, leaseExpiresAt: null } });
    } catch {
      if (signal?.aborted) await releaseOutboxClaimForShutdown(effect.id, leaseToken,effect.bookingId,claimedBookingVersion);
      else await recordOutboxRetry(effect, workspaceId, leaseToken, claimedBookingVersion, now);
    }
  }
  return { attempted, pending: await db.integrationOutbox.count({ where: { bookingId, workspaceId, status: { in: ["PENDING", "RETRY", "PROCESSING"] } } }) };
}

export async function processBookingOutbox(bookingId: string) {
  const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { workspaceId: true } });
  return processOutbox(booking.workspaceId, bookingId);
}

export async function drainDueOutbox(now = new Date(), signal?: AbortSignal) {
  const due = await db.integrationOutbox.findMany({ where: { OR: [
    { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: now } },
    { status: "PROCESSING", leaseExpiresAt: { lte: now } },
  ] }, select: { workspaceId: true }, take: 100 });
  const workspaces = [...new Set(due.map((item) => item.workspaceId))];
  for (const workspaceId of workspaces) { if (signal?.aborted) break; await processOutbox(workspaceId, undefined, now, undefined, undefined, signal); }
  assertWorkerRunning(signal);
  const oauth = await retryPendingGoogleDisconnects(now,undefined,signal);
  return { owners: workspaces.length, oauth };
}
