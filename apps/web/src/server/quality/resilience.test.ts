import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { CalendarService } from "@/server/services/calendar";
import { INTEGRATION_MAX_ATTEMPTS, processOutbox, recordOutboxRetry, withProviderDeadline } from "@/server/services/outbox";

const bookingIds: string[] = [];
async function fixture(label: string, status = "CONFIRMED", mutationVersion = 0) {
  const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const id = randomUUID(); bookingIds.push(id);
  const booking = await db.booking.create({ data: { id, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: label, inviteeEmail: `${label.toLowerCase().replaceAll(/[^a-z]/g, "-")}@example.invalid`, inviteeTimeZone: "UTC", startAt: new Date("2099-09-01T15:00:00Z"), endAt: new Date("2099-09-01T15:30:00Z"), status, calendarProviderSnapshot: "google", eventTitleSnapshot: event.name, locationTypeSnapshot: "CUSTOM", idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-10-01T00:00:00Z"), mutationVersion } });
  return { booking, event };
}
const noBusy = async () => [];

describe("quality resilience failpoint matrix", () => {
  beforeEach(() => { Object.assign(process.env, { NODE_ENV: "test", CALENDAR_PROVIDER: "local" }); });
  afterEach(async () => { await db.booking.deleteMany({ where: { id: { in: bookingIds.splice(0) } } }); });

  it("reclaims a post-lease worker crash exactly once after expiry", async () => {
    const { booking } = await fixture("Lease Reclaim");
    await db.integrationOutbox.create({ data: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_CREATE", idempotencyKey: `quality:lease:${booking.id}`, status: "PROCESSING", leaseToken: "dead-worker", leaseExpiresAt: new Date("2020-01-01T00:00:00Z"), attemptCount: 1 } });
    let calls = 0; const calendar: CalendarService = { getBusyIntervals: noBusy, async createBookingEvent() { calls += 1; return { eventId: `quality-${booking.id}`, etag: "v1", disposition: "created" }; }, async updateBookingEvent() {}, async deleteBookingEvent() {} };
    await Promise.all([processOutbox(booking.workspaceId, booking.id, new Date(), calendar), processOutbox(booking.workspaceId, booking.id, new Date(), calendar)]);
    expect(calls).toBe(1); expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId: booking.id } })).toMatchObject({ status: "COMPLETED", leaseToken: null });
  });

  it("reconciles an acknowledged provider create after a pre-commit crash without duplicate authority", async () => {
    const { booking } = await fixture("Provider Ack");
    await db.integrationOutbox.create({ data: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_CREATE", idempotencyKey: `quality:ack:${booking.id}` } });
    const remote = new Set<string>(); let calls = 0;
    const calendar: CalendarService = { getBusyIntervals: noBusy, async createBookingEvent() { calls += 1; const id = `quality-${booking.id}`; remote.add(id); if (calls === 1) throw new Error("ACKNOWLEDGED_THEN_CONNECTION_LOST"); return { eventId: id, etag: "v1", disposition: "conflict" }; }, async updateBookingEvent() {}, async deleteBookingEvent() {} };
    await processOutbox(booking.workspaceId, booking.id, new Date(), calendar);
    await db.integrationOutbox.updateMany({ where: { bookingId: booking.id }, data: { nextAttemptAt: new Date("2020-01-01T00:00:00Z") } });
    await processOutbox(booking.workspaceId, booking.id, new Date(), calendar);
    expect(remote.size).toBe(1); expect(calls).toBe(2); expect(await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ externalCalendarEventId: `quality-${booking.id}`, calendarSyncStatus: "SYNCED" });
  });

  it("suppresses a stale update immediately before the provider boundary", async () => {
    const { booking } = await fixture("Stale Update", "CONFIRMED", 2);
    await db.integrationOutbox.create({ data: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_UPDATE", bookingMutationVersion: 1, idempotencyKey: `quality:stale:${booking.id}` } });
    let calls = 0; const calendar: CalendarService = { getBusyIntervals: noBusy, async createBookingEvent() { return null; }, async updateBookingEvent() { calls += 1; }, async deleteBookingEvent() {} };
    await processOutbox(booking.workspaceId, booking.id, new Date(), calendar);
    expect(calls).toBe(0); expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId: booking.id } })).toMatchObject({ status: "COMPLETED", lastErrorCode: "STALE_CALENDAR_UPDATE" });
  });

  it("bounds provider timeout and terminalizes only at the declared attempt ceiling", async () => {
    await expect(withProviderDeadline(new Promise(() => undefined), 20)).rejects.toThrow("CALENDAR_PROVIDER_TIMEOUT");
    const { booking } = await fixture("Retry Ceiling"); const effect = await db.integrationOutbox.create({ data: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_CREATE", idempotencyKey: `quality:dead:${booking.id}`, status: "PROCESSING", leaseToken: "quality-lease", leaseExpiresAt: new Date("2099-12-01T00:00:00Z"), attemptCount: INTEGRATION_MAX_ATTEMPTS - 1 } });
    expect(await recordOutboxRetry(effect, booking.workspaceId, "quality-lease", booking.mutationVersion, new Date())).toBe(true);
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { id: effect.id } })).toMatchObject({ status: "DEAD", lastErrorCode: "PROVIDER_OPERATION_FAILED", leaseToken: null });
  });

  it("releases a post-claim shutdown without consuming retry budget or calling provider", async () => {
    const { booking } = await fixture("Shutdown"); await db.integrationOutbox.create({ data: { workspaceId: booking.workspaceId, bookingId: booking.id, kind: "CALENDAR_CREATE", idempotencyKey: `quality:shutdown:${booking.id}` } });
    const controller = new AbortController(); controller.abort(); let calls = 0; const calendar: CalendarService = { getBusyIntervals: noBusy, async createBookingEvent() { calls += 1; return null; }, async updateBookingEvent() { calls += 1; }, async deleteBookingEvent() { calls += 1; } };
    expect((await processOutbox(booking.workspaceId, booking.id, new Date(), calendar, undefined, controller.signal)).attempted).toBe(0); expect(calls).toBe(0);
    expect(await db.integrationOutbox.findFirstOrThrow({ where: { bookingId: booking.id } })).toMatchObject({ status: "PENDING", attemptCount: 0 });
  });
});
