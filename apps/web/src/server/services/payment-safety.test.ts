import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";

describe("payment and booking authority migration guards", () => {
  it("binds a booking host to the exact EventType owner and blocks booked owner transfer", async () => {
    const event = await db.eventType.findFirstOrThrow({ include: { durations: true } });
    const duration = event.durations[0]!;
    const other = await db.user.create({ data: {
      name: "Same workspace other host", email: `other-host-${randomUUID()}@example.invalid`, passwordHash: "test-only-password-hash",
      memberships: { create: { workspaceId: event.workspaceId, role: "MEMBER", status: "ACTIVE" } },
    } });
    const base = {
      workspaceId: event.workspaceId, eventTypeId: event.id, durationId: duration.id, durationMinutes: duration.durationMinutes,
      inviteeName: "Authority Test", inviteeEmail: "authority-test@example.invalid", inviteeTimeZone: "UTC",
      startAt: new Date("2099-10-01T15:00:00Z"), endAt: new Date("2099-10-01T15:30:00Z"),
      capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-11-01T00:00:00Z"),
    };
    await expect(db.booking.create({ data: { ...base, hostId: other.id } })).rejects.toThrow();
    const booking = await db.booking.create({ data: { ...base, hostId: event.ownerId } });
    await expect(db.booking.update({ where: { id: booking.id }, data: { hostId: other.id } })).rejects.toThrow();
    await expect(db.eventType.update({ where: { id: event.id }, data: { ownerId: other.id } })).rejects.toThrow();
    await db.booking.delete({ where: { id: booking.id } });
    await db.membership.deleteMany({ where: { userId: other.id } });
    await db.user.delete({ where: { id: other.id } });
  });

  it("keeps SQLite and PostgreSQL forward migrations fail-closed on predecessor host mismatches", () => {
    const sqlite = readFileSync("prisma/migrations/202608240003_payment_investor_safety/migration.sql", "utf8");
    const postgres = readFileSync("prisma/postgresql/migrations/202608240003_payment_investor_safety/migration.sql", "utf8");
    const guards = readFileSync("prisma/postgresql/postgres-guards.sql", "utf8");
    for (const source of [sqlite, postgres]) {
      expect(source).toContain('e."ownerId"<>b."hostId"');
      expect(source).toContain("booking host must equal event owner");
      expect(source).toContain("booked event owner cannot be transferred");
    }
    expect(sqlite).toContain('CREATE TEMP TABLE "__booking_host_authority_preflight"');
    expect(postgres).toContain("booking host authority preflight failed");
    expect(guards).toContain('e."ownerId"=NEW."hostId"');
  });

  it("aborts an inconsistent SQLite upgrade before durable DDL and succeeds after remediation", () => {
    const scratch = mkdtempSync(join(tmpdir(), "tempocove-payment-upgrade-"));
    const sqlite = new DatabaseSync(join(scratch, "upgrade.db"));
    try {
      sqlite.exec("PRAGMA foreign_keys=ON");
      const migrationsRoot = "prisma/migrations";
      const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("._")).map((entry) => entry.name).sort();
      for (const directory of migrationDirectories) {
        if (directory === "202608240003_payment_investor_safety") continue;
        sqlite.exec(readFileSync(join(migrationsRoot, directory, "migration.sql"), "utf8"));
      }
      sqlite.exec(`
        INSERT INTO "Workspace"("id","name","createdAt","updatedAt") VALUES ('w','Workspace',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "User"("id","email","name","passwordHash","createdAt","updatedAt") VALUES ('a','a@example.invalid','A','hash',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('b','b@example.invalid','B','hash',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "Membership"("id","workspaceId","userId","role","status","createdAt","updatedAt") VALUES ('ma','w','a','OWNER','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('mb','w','b','MEMBER','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        INSERT INTO "EventType"("id","workspaceId","ownerId","name","slug","createdAt","updatedAt") VALUES ('e','w','a','Event','upgrade-event',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
        DROP TRIGGER "Booking_workspace_guard_insert";
        DROP TRIGGER "Booking_workspace_guard_update";
        INSERT INTO "Booking"("id","workspaceId","eventTypeId","hostId","durationMinutes","inviteeName","inviteeEmail","inviteeTimeZone","startAt","endAt","createdAt","updatedAt") VALUES ('bad','w','e','b',30,'Guest','guest@example.invalid','UTC','2099-01-01','2099-01-01 00:30:00',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      `);
      const migration = readFileSync("prisma/migrations/202608240003_payment_investor_safety/migration.sql", "utf8");
      expect(() => sqlite.exec(migration)).toThrow();
      expect((sqlite.prepare("SELECT count(*) AS count FROM pragma_table_info('Booking') WHERE name='refundStatus'").get() as { count: number }).count).toBe(0);
      sqlite.exec('DELETE FROM "Booking" WHERE id=\'bad\'');
      expect(() => sqlite.exec(migration)).not.toThrow();
      expect((sqlite.prepare("SELECT count(*) AS count FROM pragma_table_info('Booking') WHERE name='refundStatus'").get() as { count: number }).count).toBe(1);
    } finally { sqlite.close(); rmSync(scratch, { recursive: true, force: true }); }
  });

  it("keeps paid retry authority server-side and stores no booking PII in browser retry state", () => {
    const createRoute = readFileSync("apps/web/src/app/api/public/[slug]/bookings/route.ts", "utf8");
    const resumeRoute = readFileSync("apps/web/src/app/api/bookings/[id]/checkout/resume/route.ts", "utf8");
    const attempt = readFileSync("apps/web/src/components/booking-attempt.ts", "utf8");
    expect(createRoute).toContain("exchangeBookingCapabilities(created.booking.id");
    expect(createRoute).toContain("manageCapabilities: null");
    expect(createRoute).toContain("response.cookies.set(manageCookieName(created.booking.id)");
    expect(resumeRoute).toContain('requireBookingManageSession(request, id, "read")');
    expect(attempt).toContain("type StoredBookingAttempt = { fingerprint: string; key: string; bookingId?: string }");
    expect(attempt).not.toMatch(/StoredBookingAttempt[^\n]*(invitee|notes|answers|input)/i);
  });
});
