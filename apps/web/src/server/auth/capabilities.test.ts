import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acknowledgeBookingManageSession, capabilityRows, exchangeBookingCapabilities, manageCookieName, materializeCapabilities, newCapabilityIdentity, requireBookingCapability, requireBookingManageSession } from "@/server/auth/capabilities";
import { db } from "@/server/db";

describe("scoped booking capabilities", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "a-strong-test-secret-that-is-longer-than-thirty-two-bytes";
    process.env.BOOKING_CAPABILITY_KEY_ID = "test-capability-v1";
    process.env.BOOKING_CAPABILITY_SECRET = "test-capability-secret-that-is-longer-than-thirty-two-bytes";
  });
  afterEach(() => { for (const name of ["AUTH_SECRET","BOOKING_CAPABILITY_KEY_ID","BOOKING_CAPABILITY_SECRET","BOOKING_CAPABILITY_KEYRING"]) delete process.env[name]; });

  it("derives separate expiring capabilities and stores only hashes", () => {
    const expiresAt = new Date("2026-09-20T00:00:00.000Z");
    const tokens = materializeCapabilities("booking-1", "version-1", expiresAt, "test-capability-v1");
    if (!tokens) throw new Error("expected configured capability bundle");
    expect(new Set([tokens.read, tokens.cancel, tokens.reschedule]).size).toBe(3);
    const rows = capabilityRows("booking-1", "version-1", expiresAt, "test-capability-v1");
    expect(rows.map((row) => row.scope)).toEqual(["read", "cancel", "reschedule"]);
    expect(rows[0]!.tokenHash).toBe(createHash("sha256").update(tokens.read).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(tokens.read);
  });

  it("retains old capability bundles only while their versioned signing key remains available", () => {
    const expiresAt = new Date("2099-09-20T00:00:00.000Z");
    const identityA = newCapabilityIdentity(expiresAt, new Date("2098-01-01T00:00:00.000Z"));
    const bundleA = materializeCapabilities("rotation-booking", identityA.version, identityA.expiresAt, identityA.keyId);
    expect(bundleA).not.toBeNull();
    const rowsA = capabilityRows("rotation-booking", identityA.version, identityA.expiresAt, identityA.keyId);

    process.env.BOOKING_CAPABILITY_KEY_ID = "test-capability-v2";
    process.env.BOOKING_CAPABILITY_SECRET = "second-capability-secret-that-is-longer-than-thirty-two-bytes";
    process.env.BOOKING_CAPABILITY_KEYRING = JSON.stringify({
      "test-capability-v1": "test-capability-secret-that-is-longer-than-thirty-two-bytes",
    });
    expect(materializeCapabilities("rotation-booking", identityA.version, identityA.expiresAt, identityA.keyId)).toEqual(bundleA);

    process.env.BOOKING_CAPABILITY_KEYRING = "{}";
    expect(materializeCapabilities("rotation-booking", identityA.version, identityA.expiresAt, identityA.keyId)).toBeNull();
    expect(() => capabilityRows("rotation-booking", identityA.version, identityA.expiresAt, identityA.keyId)).toThrow(/unavailable/);
    const identityB = newCapabilityIdentity(expiresAt, new Date("2098-01-01T00:00:00.000Z"));
    expect(identityB.keyId).toBe("test-capability-v2");
    expect(capabilityRows("rotation-booking", identityB.version, identityB.expiresAt, identityB.keyId).map((row) => row.tokenHash)).not.toEqual(rowsA.map((row) => row.tokenHash));
  });

  it("rejects malformed or weak retained-key configuration", () => {
    process.env.BOOKING_CAPABILITY_KEYRING = '{"retired-v1":"short"}';
    expect(() => materializeCapabilities("booking", "version", new Date("2099-01-01T00:00:00Z"), "retired-v1")).toThrow(/at least 32 bytes/);
    process.env.BOOKING_CAPABILITY_KEYRING = "not-json";
    expect(() => materializeCapabilities("booking", "version", new Date("2099-01-01T00:00:00Z"), "retired-v1")).toThrow(/JSON object/);
  });

  it("preserves the applied Phase-9 migration checksum and moves correction forward", () => {
    const phase9 = readFileSync("prisma/migrations/202608210012_phase9_provider_backfill/migration.sql");
    const phase11 = readFileSync("prisma/migrations/202608210013_phase11_provider_lineage/migration.sql", "utf8");
    expect(createHash("sha256").update(phase9).digest("hex").toUpperCase()).toBe("99A7A11B502B8776B8667DAD6214D94A99F8C2D28F4F93B90B978DD21D425661");
    expect(phase9.toString("utf8")).not.toContain("provider_recovery_required"); expect(phase11).toContain("provider_recovery_required");
  });

  it("exchanges exact hashes once and never accepts a sibling capability", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!;
    const bookingId = randomUUID(); const identity = newCapabilityIdentity(new Date("2099-01-01T00:30:00Z"), new Date("2098-12-01T00:00:00Z"));
    const tokens = materializeCapabilities(bookingId, identity.version, identity.expiresAt, identity.keyId);
    if (!tokens) throw new Error("expected configured capability bundle");
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Capability Test", inviteeEmail: "capability@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-01-01T00:00:00Z"), endAt: new Date("2099-01-01T00:30:00Z"),
      idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: identity.version, capabilityKeyId: identity.keyId, manageExpiresAt: identity.expiresAt,
      capabilities: { createMany: { data: capabilityRows(bookingId, identity.version, identity.expiresAt, identity.keyId).map(({ bookingId: ignored, ...row }) => { void ignored; return row; }) } },
    } });
    await expect(requireBookingCapability(bookingId, "cancel", tokens.read)).rejects.toThrow(/Booking/);
    const exchangedAt = new Date("2026-08-21T12:00:00Z");
    const exchanged = await exchangeBookingCapabilities(bookingId, tokens, exchangedAt);
    expect(exchanged.expiresAt).toEqual(identity.expiresAt);
    expect(manageCookieName(bookingId)).not.toBe(manageCookieName("another-booking"));
    const cookieName = manageCookieName(bookingId); const oldRequest = new Request("http://localhost", { headers: { cookie: `${cookieName}=${exchanged.token}` } });
    await expect(requireBookingManageSession(oldRequest, bookingId, "read")).resolves.toMatchObject({ bookingId });
    await expect(requireBookingManageSession(oldRequest, bookingId, "reschedule")).rejects.toThrow(/Booking/);
    await expect(requireBookingCapability(bookingId, "cancel", tokens.cancel)).resolves.toMatchObject({ bookingId });
    expect(await exchangeBookingCapabilities(bookingId, tokens, new Date(exchangedAt.getTime() + 24 * 60 * 60_000))).toEqual(exchanged);
    await acknowledgeBookingManageSession(oldRequest, bookingId, new Date(exchangedAt.getTime() + 24 * 60 * 60_000));
    await expect(acknowledgeBookingManageSession(oldRequest, bookingId, new Date(exchangedAt.getTime() + 24 * 60 * 60_000 + 1))).resolves.toEqual({ acknowledged: true });
    const session = await requireBookingManageSession(oldRequest, bookingId, "reschedule");
    await expect(requireBookingManageSession(oldRequest, bookingId, "reschedule")).resolves.toMatchObject({ id: session.id });
    await expect(requireBookingCapability(bookingId, "cancel", tokens.cancel)).rejects.toThrow(/Booking/);
    await expect(exchangeBookingCapabilities(bookingId, tokens, new Date(exchangedAt.getTime() + 24 * 60 * 60_000 + 1))).rejects.toThrow(/Booking/);
    expect(await db.bookingManageSession.count({ where: { bookingId } })).toBe(1);
    expect(await db.bookingCapability.count({ where: { bookingId, revokedAt: { not: null } } })).toBe(3);
    await db.booking.delete({ where: { id: bookingId } });
  });

  it("upgrades a pre-ack manage session whose exact source bundle was already revoked", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } }); const duration = event.durations[0]!; const bookingId = randomUUID(); const expiresAt = new Date("2099-01-01T00:00:00Z"); const identity = newCapabilityIdentity(expiresAt, new Date("2098-01-01T00:00:00Z"));
    await db.booking.create({ data: {
      id: bookingId, workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Upgrade", inviteeEmail: "upgrade@example.com", inviteeTimeZone: "UTC", startAt: new Date("2098-12-01T00:00:00Z"), endAt: new Date("2098-12-01T00:30:00Z"), idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: identity.version, manageExpiresAt: identity.expiresAt,
      capabilityKeyId: identity.keyId,
      capabilities: { createMany: { data: capabilityRows(bookingId, identity.version, identity.expiresAt, identity.keyId).map(({ bookingId: ignored, ...row }) => { void ignored; return { ...row, revokedAt: new Date("2098-01-02T00:00:00Z") }; }) } },
      manageSessions: { create: { tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), scopes: "read,cancel,reschedule", expiresAt } },
    } });
    await db.$executeRawUnsafe(`UPDATE "BookingManageSession" SET "acknowledgedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) WHERE "acknowledgedAt" IS NULL AND 3 = (SELECT COUNT(DISTINCT "scope") FROM "BookingCapability" WHERE "BookingCapability"."bookingId" = "BookingManageSession"."bookingId" AND "revokedAt" IS NOT NULL) AND 0 = (SELECT COUNT(*) FROM "BookingCapability" WHERE "BookingCapability"."bookingId" = "BookingManageSession"."bookingId" AND "revokedAt" IS NULL)`);
    expect(await db.bookingManageSession.findFirstOrThrow({ where: { bookingId } })).toMatchObject({ acknowledgedAt: expect.any(Date) });
    await db.booking.delete({ where: { id: bookingId } });
  });
});
