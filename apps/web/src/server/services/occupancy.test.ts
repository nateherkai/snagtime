import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { occupiedMinutes } from "@/server/services/bookings";

const createdIds: string[] = [];
afterAll(async () => { if (createdIds.length) await db.booking.deleteMany({ where: { id: { in: createdIds } } }); });

describe("database booking occupancy", () => {
  it("allows exactly one winner in a twenty-request overlap race", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } });
    const duration = event.durations[0]!;
    const startAt = new Date("2099-01-05T15:00:00.000Z"); const endAt = new Date("2099-01-05T15:30:00.000Z");
    const ids = Array.from({ length: 20 }, () => randomUUID()); createdIds.push(...ids);
    await db.booking.createMany({ data: ids.map((id) => ({
        id, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id,
        durationMinutes: 30, priceCents: 0, currency: "usd", inviteeName: "Race Test",
        inviteeEmail: `${id}@example.com`, inviteeTimeZone: "UTC", startAt, endAt,
        capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00.000Z"),
    })) });
    const attempts = await Promise.allSettled(ids.map((id) => db.bookingOccupancy.createMany({ data: occupiedMinutes(startAt, endAt, 0, 0).map((minuteStart) => ({ workspaceId: event.workspaceId, bookingId: id, hostId: event.ownerId, minuteStart })) })));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await db.bookingOccupancy.count({ where: { hostId: event.ownerId, minuteStart: { gte: startAt, lt: endAt } } })).toBe(30);
  }, 20_000);
});
