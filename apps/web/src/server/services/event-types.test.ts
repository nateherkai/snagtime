import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { clearGoogleScopeHealthCache, getGoogleScopeHealth } from "@/server/services/calendar";
import { updateEventType } from "@/server/services/event-types";

describe("event duration lifecycle", () => {
  it("checks the persisted event owner calendar when a different admin edits the event", async () => {
    const owner = await db.user.findFirstOrThrow({ include: { memberships: { where: { status: "ACTIVE" }, take: 1 } } }); const workspaceId = owner.memberships[0]!.workspaceId;
    const admin = await db.user.create({ data: { email: `event-admin-${randomUUID()}@example.com`, name: "Event admin", passwordHash: "test", emailVerifiedAt: new Date(), timeZone: "UTC", memberships: { create: { workspaceId, role: "ADMIN" } } } });
    const event = await db.eventType.create({ data: { workspaceId, ownerId: owner.id, name: "Owner calendar", slug: `owner-calendar-${randomUUID()}`, locationType: "CUSTOM", isActive: true } });
    const checked: Array<{ userId: string; workspaceId?: string }> = [];
    await expect(updateEventType(workspaceId, admin.id, event.id, { locationType: "GOOGLE_MEET" }, async (userId, checkedWorkspaceId) => { checked.push({ userId, workspaceId: checkedWorkspaceId }); return true; })).resolves.toMatchObject({ locationType: "GOOGLE_MEET" });
    expect(checked).toEqual([{ userId: owner.id, workspaceId }]);
    await db.eventType.delete({ where: { id: event.id } }); await db.user.delete({ where: { id: admin.id } });
  });

  it("keeps booked duration identities stable and retires omitted options", async () => {
    const owner = await db.user.findFirstOrThrow({ include: { memberships: { where: { status: "ACTIVE" }, take: 1 } } }); const workspaceId = owner.memberships[0]!.workspaceId; const slug = `duration-${randomUUID()}`;
    const event = await db.eventType.create({ data: { workspaceId, ownerId: owner.id, name: "Duration test", slug, durationMinutes: 30, locationType: "CUSTOM", locationValue: "Test location", durations: { create: [
      { label: "30 min", durationMinutes: 30, isDefault: true, priceCents: 0, position: 0 },
      { label: "60 min", durationMinutes: 60, isDefault: false, priceCents: 0, position: 1 },
    ] }, questions: { create: [
      { label: "Original question", kind: "TEXT", required: true, position: 0 },
      { label: "Retire me", kind: "TEXT", required: false, position: 1 },
    ] } }, include: { durations: true, questions: true } });
    const used = event.durations.find((item) => item.durationMinutes === 30)!; const omitted = event.durations.find((item) => item.durationMinutes === 60)!;
    const booking = await db.booking.create({ data: {
      workspaceId, eventTypeId: event.id, hostId: owner.id, durationId: used.id, durationMinutes: 30, inviteeName: "Booked", inviteeEmail: "booked@example.com", inviteeTimeZone: "UTC",
      startAt: new Date("2099-06-01T00:00:00Z"), endAt: new Date("2099-06-01T00:30:00Z"), idempotencyKey: randomUUID(), requestFingerprint: randomUUID(), capabilityVersion: randomUUID(), manageExpiresAt: new Date("2099-07-01T00:00:00Z"),
      answers: { create: { questionId: event.questions[0]!.id, questionLabel: event.questions[0]!.label, valueJson: '"kept"' } },
    } });
    await updateEventType(workspaceId, owner.id, event.id, { durations: [
      { id: used.id, label: "Focused 30", durationMinutes: 30, isDefault: false, priceCents: 0, currency: "usd", position: 0 },
      { label: "45 min", durationMinutes: 45, isDefault: true, priceCents: 0, currency: "usd", position: 1 },
    ], questions: [
      { id: event.questions[0]!.id, label: "Updated question", kind: "TEXTAREA", required: true, options: [], position: 0 },
      { label: "New question", kind: "CHECKBOX", required: false, options: [], position: 1 },
    ] });
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).durationId).toBe(used.id);
    expect(await db.eventDuration.findUniqueOrThrow({ where: { id: used.id } })).toMatchObject({ label: "Focused 30", isActive: true });
    expect((await db.eventDuration.findUniqueOrThrow({ where: { id: omitted.id } })).isActive).toBe(false);
    expect(await db.customQuestion.findUniqueOrThrow({ where: { id: event.questions[0]!.id } })).toMatchObject({ label: "Updated question", isActive: true });
    expect((await db.customQuestion.findUniqueOrThrow({ where: { id: event.questions[1]!.id } })).isActive).toBe(false);
    expect(await db.bookingAnswer.count({ where: { bookingId: booking.id, questionId: event.questions[0]!.id } })).toBe(1);
    delete process.env.CALENDAR_PROVIDER;
    await expect(updateEventType(workspaceId, owner.id, event.id, { locationType: "GOOGLE_MEET" })).rejects.toThrow(/Connect an active Google Calendar/);
    process.env.CALENDAR_PROVIDER = "google"; process.env.GOOGLE_CLIENT_ID = "env-client"; process.env.GOOGLE_CLIENT_SECRET = "env-secret"; process.env.GOOGLE_REFRESH_TOKEN = "env-refresh"; process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = workspaceId;
    await getGoogleScopeHealth(owner.id, async () => ({ scopeHealth: "complete", missingScopes: [] }), Date.now(), workspaceId);
    await expect(updateEventType(workspaceId, owner.id, event.id, { locationType: "GOOGLE_MEET" })).resolves.toMatchObject({ locationType: "GOOGLE_MEET" });
    clearGoogleScopeHealthCache(workspaceId); delete process.env.CALENDAR_PROVIDER; delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN; delete process.env.GOOGLE_ENV_WORKSPACE_ID; delete process.env.DEMO_MODE;
    await db.booking.delete({ where: { id: booking.id } }); await db.eventType.delete({ where: { id: event.id } });
  });
});
