import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { db } from "@/server/db";
import { assertProductionRuntimeSecurity, createSessionForUser, getSessionRecord, rotateSessionWorkspace, SESSION_COOKIE, type WorkspaceAccess } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { changeAccountPassword, getAccountSummary, registerAccount, updateMembershipRole } from "@/server/services/accounts";
import { getAvailability } from "@/server/services/availability";
import { setBranding } from "@/server/services/branding";
import { getEventTypeById, listEventTypes } from "@/server/services/event-types";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { GET as sessionRoute, POST as loginRoute } from "@/app/api/auth/session/route";
import { PATCH as profileImageRoute } from "@/app/api/account/profile-image/route";
import { resetRateLimitsForTest } from "@/server/rate-limit";

const workspaceIds: string[] = [];
const userIds: string[] = [];
const authSecret = "workspace-test-auth-secret-which-is-long-enough";

async function account(label: string, establishSession = true) {
  const email = `${label}-${crypto.randomUUID()}@example.com`;
  await registerAccount({
    name: `${label} Owner`, email,
    password: "Strong!Workspace9", workspaceName: `${label} Workspace`, timeZone: "America/Chicago",
  });
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { workspace: true } } } });
  const membership = user.memberships[0]!; const workspace = membership.workspace;
  const token = establishSession ? await createSessionForUser(user.id, membership.id) : "";
  workspaceIds.push(workspace.id); userIds.push(user.id);
  const access: WorkspaceAccess = {
    sessionId: "test", user, workspace, membership,
    workspaceId: workspace.id, role: "OWNER",
  };
  return { user, workspace, membership, token, access };
}

function sessionRequest(token: string, method = "GET") {
  return new Request("http://localhost:3000/api/account", { method, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, origin: "http://localhost:3000" } });
}

function profileImageRequest(token: string, imageUrl: string | null) {
  return new Request("http://localhost:3000/api/account/profile-image", { method: "PATCH", headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ imageUrl }) });
}

describe("production workspace accounts", () => {
  beforeEach(() => { resetRateLimitsForTest(); process.env.AUTH_SECRET = authSecret; process.env.EMAIL_TOKEN_SECRET = "accounts-test-email-token-secret-which-is-long-enough"; process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"; delete process.env.DEMO_MODE; });
  afterEach(async () => {
    const ownedWorkspaceIds = workspaceIds.splice(0);
    if (ownedWorkspaceIds.length > 0) {
      await db.booking.deleteMany({ where: { workspaceId: { in: ownedWorkspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: ownedWorkspaceIds } } });
    }
    const ownedUserIds = userIds.splice(0);
    if (ownedUserIds.length > 0) await db.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    delete process.env.AUTH_SECRET; delete process.env.EMAIL_TOKEN_SECRET; delete process.env.NEXT_PUBLIC_APP_URL; delete process.env.EMAIL_PROVIDER; delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; delete process.env.SMTP_USER; delete process.env.SMTP_PASSWORD; delete process.env.EMAIL_FROM;
    vi.unstubAllEnvs();
  });

  it("registers scoped defaults atomically but returns the same credential-free result for new and duplicate email", async () => {
    const email=`register-${crypto.randomUUID()}@example.com`,input={name:"register Owner",email,password:"Strong!Workspace9",workspaceName:"register Workspace",timeZone:"America/Chicago"};
    const createdPhases:string[]=[]; await registerAccount(input,(phase)=>createdPhases.push(phase));
    const user=await db.user.findUniqueOrThrow({where:{email},include:{memberships:{include:{workspace:true}}}}),membership=user.memberships[0]!,created={user,workspace:membership.workspace};
    userIds.push(user.id); workspaceIds.push(membership.workspaceId);
    expect(await db.authSession.count({ where: { userId: created.user.id } })).toBe(0);
    expect(await db.workspaceBranding.count({ where: { workspaceId: created.workspace.id } })).toBe(1);
    expect(await db.availabilitySchedule.count({ where: { workspaceId: created.workspace.id, userId: created.user.id } })).toBe(1);
    const duplicatePhases:string[]=[]; await expect(registerAccount({ name: "Duplicate", email: created.user.email, password: "Other!Workspace9", workspaceName: "No Leak", timeZone: "UTC" },(phase)=>duplicatePhases.push(phase))).resolves.toEqual({ accepted: true });
    expect(createdPhases).toEqual(["PASSWORD_KDF","USER_INSERT","WORKSPACE_INSERT","MEMBERSHIP_INSERT","BRANDING_INSERT","AVAILABILITY_INSERT","TOKEN_REVOKE","TOKEN_INSERT","OUTBOX_INSERT"]);
    expect(duplicatePhases).toEqual(createdPhases);
    expect(await db.workspace.count({ where: { name: "No Leak" } })).toBe(0);
  });

  it("serializes concurrent duplicate registrations through the same fixed phase trace", async()=>{
    const email=`register-race-${crypto.randomUUID()}@example.com`,traces=Array.from({length:6},()=>[] as string[]);
    await expect(Promise.all(traces.map((trace,index)=>registerAccount({name:`Race ${index}`,email,password:"Strong!Workspace9",workspaceName:`Race Workspace ${index}`,timeZone:"UTC"},phase=>trace.push(phase))))).resolves.toHaveLength(6);
    for(const trace of traces) expect(trace).toEqual(traces[0]);
    const user=await db.user.findUniqueOrThrow({where:{email},include:{memberships:true}});userIds.push(user.id);workspaceIds.push(user.memberships[0]!.workspaceId);
    expect(await db.user.count({where:{email}})).toBe(1);expect(user.memberships).toHaveLength(1);
    expect(await db.workspaceBranding.count({where:{workspaceId:user.memberships[0]!.workspaceId}})).toBe(1);
    expect(await db.availabilitySchedule.count({where:{workspaceId:user.memberships[0]!.workspaceId,userId:user.id}})).toBe(1);
    expect(await db.accountActionToken.count({where:{userId:user.id,purpose:"EMAIL_VERIFY",revokedAt:null}})).toBe(1);
    expect(await db.emailOutbox.count({where:{workspaceId:user.memberships[0]!.workspaceId,kind:"EMAIL_VERIFY"}})).toBe(1);
  });

  it("keeps the canonical workspace identity synchronized with saved branding", async () => {
    const created = await account("branding-identity", false);
    const logoUrl = null;
    await expect(setBranding(created.workspace.id, created.user.id, { workspaceName: "Renamed workspace", logoUrl, accentColor: "#2255AA", description: "Updated", footerText: null })).resolves.toMatchObject({ workspaceName: "Renamed workspace", logoUrl });
    await expect(db.workspace.findUniqueOrThrow({ where: { id: created.workspace.id } })).resolves.toMatchObject({ name: "Renamed workspace" });
    await expect(getAccountSummary(created.access)).resolves.toMatchObject({ workspace: { name: "Renamed workspace" }, workspaces: [{ name: "Renamed workspace" }] });
  });

  it("canonicalizes branding images, rejects new remote URLs, and preserves an unchanged legacy remote URL", async () => {
    const created = await account("branding-image", false);
    const input = { workspaceName: "Brand image", logoUrl: "https://attacker.example/new.png", accentColor: "#2255AA", description: null, footerText: null };
    await expect(setBranding(created.workspace.id, created.user.id, input)).rejects.toMatchObject({ code: "INVALID_IMAGE", fieldErrors: { logoUrl: [expect.stringMatching(/Remote image URLs/)] } });
    const legacy = "https://legacy.example/persisted.png";
    await db.workspaceBranding.update({ where: { workspaceId: created.workspace.id }, data: { logoUrl: legacy } });
    await expect(setBranding(created.workspace.id, created.user.id, { ...input, workspaceName: "Legacy renamed", logoUrl: legacy })).resolves.toMatchObject({ workspaceName: "Legacy renamed", logoUrl: legacy });
    const png = await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 40, g: 90, b: 140, alpha: 0.5 } } }).png().toBuffer();
    const saved = await setBranding(created.workspace.id, created.user.id, { ...input, logoUrl: `data:image/png;base64,${png.toString("base64")}` });
    expect(saved.logoUrl).toMatch(/^data:image\/webp;base64,/);
    await expect(db.workspaceBranding.findUniqueOrThrow({ where: { workspaceId: created.workspace.id } })).resolves.toMatchObject({ logoUrl: saved.logoUrl });
  });

  it("updates and clears only the authenticated profile image and refreshes session responses", async () => {
    const created = await account("profile-image"); const other = await account("profile-other");
    const png = await sharp({ create: { width: 10, height: 6, channels: 3, background: "#2255AA" } }).png().toBuffer();
    const update = await profileImageRoute(profileImageRequest(created.token, `data:image/png;base64,${png.toString("base64")}`));
    expect(update.status).toBe(200); const updatedBody = await update.json(); const canonical = updatedBody.data.imageUrl as string;
    expect(canonical).toMatch(/^data:image\/webp;base64,/);
    await expect(db.user.findUniqueOrThrow({ where: { id: created.user.id } })).resolves.toMatchObject({ imageUrl: canonical });
    await expect(db.user.findUniqueOrThrow({ where: { id: other.user.id } })).resolves.toMatchObject({ imageUrl: null });
    const refreshed = await sessionRoute(sessionRequest(created.token));
    await expect(refreshed.json()).resolves.toMatchObject({ data: { user: { id: created.user.id, imageUrl: canonical } } });

    const rejected = await profileImageRoute(profileImageRequest(created.token, "https://attacker.example/avatar.png"));
    expect(rejected.status).toBe(422); await expect(rejected.json()).resolves.toMatchObject({ error: { code: "INVALID_IMAGE", fieldErrors: { imageUrl: [expect.stringMatching(/Remote image URLs/)] } } });
    await expect(db.user.findUniqueOrThrow({ where: { id: created.user.id } })).resolves.toMatchObject({ imageUrl: canonical });

    const cleared = await profileImageRoute(profileImageRequest(created.token, null));
    expect(cleared.status).toBe(200); await expect(cleared.json()).resolves.toMatchObject({ data: { id: created.user.id, imageUrl: null } });
    const afterClear = await sessionRoute(sessionRequest(created.token));
    await expect(afterClear.json()).resolves.toMatchObject({ data: { user: { id: created.user.id, imageUrl: null } } });
  });

  it("rejects profile image writes without an authenticated workspace session", async () => {
    const response = await profileImageRoute(new Request("http://localhost:3000/api/account/profile-image", {
      method: "PATCH",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: null }),
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("keeps a legacy remote profile readable until an authenticated clear replaces it", async () => {
    const created = await account("profile-legacy"); const legacy = "https://legacy.example/avatar.jpg";
    await db.user.update({ where: { id: created.user.id }, data: { imageUrl: legacy } });
    const before = await sessionRoute(sessionRequest(created.token));
    await expect(before.json()).resolves.toMatchObject({ data: { user: { id: created.user.id, imageUrl: legacy } } });
    const cleared = await profileImageRoute(profileImageRequest(created.token, null)); expect(cleared.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: created.user.id } })).resolves.toMatchObject({ imageUrl: null });
  });

  it("returns identical generic 202 registration responses without establishing a session", async () => {
    const email = `route-${crypto.randomUUID()}@example.com`; const payload = { name: "Route Owner", email, password: "Strong!Workspace9", workspaceName: "Route Workspace", timeZone: "UTC" };
    const call = () => registerRoute(new Request("http://localhost:3000/api/auth/register", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const first = await call(); const second = await call();
    expect({ status: first.status, body: await first.json(), cookie: first.headers.get("set-cookie") }).toEqual({ status: 202, body: { data: { accepted: true, verificationPending: true } }, cookie: null });
    expect({ status: second.status, body: await second.json(), cookie: second.headers.get("set-cookie") }).toEqual({ status: 202, body: { data: { accepted: true, verificationPending: true } }, cookie: null });
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } }); userIds.push(user.id); workspaceIds.push(user.memberships[0]!.workspaceId);
    expect(await db.user.count({ where: { email } })).toBe(1); expect(await db.authSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it("returns the same authentication failure for unknown and known accounts with a wrong password", async () => {
    const created = await account("login-enumeration", false);
    const call = (email: string) => loginRoute(new Request("http://localhost:3000/api/auth/session", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ email, password: "Definitely!Wrong9" }) }));
    const known = await call(created.user.email); const unknown = await call(`absent-${crypto.randomUUID()}@example.com`);
    expect({ status: known.status, body: await known.json() }).toEqual({ status: 401, body: { error: { code: "AUTHENTICATION_FAILED", message: "Email or password is invalid." } } });
    expect({ status: unknown.status, body: await unknown.json() }).toEqual({ status: 401, body: { error: { code: "AUTHENTICATION_FAILED", message: "Email or password is invalid." } } });
  });

  it("changes the password with a predecessor CAS, revokes every old session, and rotates fixation state", async () => {
    const created = await account("password");
    const second = await createSessionForUser(created.user.id, created.membership.id, false);
    const oldHashes = (await db.authSession.findMany({ where: { userId: created.user.id, revokedAt: null }, select: { tokenHash: true } })).map((row) => row.tokenHash);
    const replacement = await changeAccountPassword(created.access, "Strong!Workspace9", "NewStrong!Workspace8");
    expect(replacement).not.toBe(created.token); expect(replacement).not.toBe(second);
    expect(await db.authSession.count({ where: { userId: created.user.id, tokenHash: { in: oldHashes }, revokedAt: null } })).toBe(0);
    expect(await getSessionRecord(sessionRequest(created.token))).toBeNull(); expect(await getSessionRecord(sessionRequest(second))).toBeNull();
    await expect(getSessionRecord(sessionRequest(replacement))).resolves.toMatchObject({ activeWorkspaceId: created.workspace.id });
    const stored = await db.user.findUniqueOrThrow({ where: { id: created.user.id } });
    expect(await verifyPassword("NewStrong!Workspace8", stored.passwordHash)).toBe(true);
    await expect(changeAccountPassword(created.access, "Strong!Workspace9", "Another!Workspace7")).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("keeps organizer roots and effects isolated between two workspaces", async () => {
    const left = await account("left"); const right = await account("right");
    const leftEvent = await db.eventType.create({ data: { workspaceId: left.workspace.id, ownerId: left.user.id, name: "Left event", slug: `left-${crypto.randomUUID()}`, durationMinutes: 30 } });
    const rightEvent = await db.eventType.create({ data: { workspaceId: right.workspace.id, ownerId: right.user.id, name: "Right event", slug: `right-${crypto.randomUUID()}`, durationMinutes: 45 } });
    expect((await listEventTypes(left.workspace.id)).map((row) => row.id)).toEqual([leftEvent.id]);
    expect((await listEventTypes(right.workspace.id)).map((row) => row.id)).toEqual([rightEvent.id]);
    await expect(getEventTypeById(left.workspace.id, rightEvent.id)).rejects.toMatchObject({ status: 404 });
    await expect(getAvailability(left.workspace.id, right.user.id)).resolves.toMatchObject({ intervals: [], overrides: [] });

    await expect(db.booking.create({ data: {
      workspaceId: left.workspace.id, eventTypeId: leftEvent.id, hostId: right.user.id,
      durationMinutes: 30,
      inviteeName: "Cross tenant", inviteeEmail: "cross@example.com", inviteeTimeZone: "UTC",
      startAt: new Date("2099-01-01T10:00:00Z"), endAt: new Date("2099-01-01T10:30:00Z"),
      idempotencyKey: crypto.randomUUID(), requestFingerprint: crypto.randomUUID(), capabilityVersion: crypto.randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00Z"),
    } })).rejects.toThrow();
    await expect(db.authSession.create({ data: {
      userId: left.user.id, activeWorkspaceId: right.workspace.id, membershipId: left.membership.id,
      tokenHash: crypto.randomUUID().replaceAll("-", ""), expiresAt: new Date("2099-01-01T00:00:00Z"),
    } })).rejects.toThrow();
    await expect(db.oAuthConnection.create({ data: { workspaceId: right.workspace.id, userId: left.user.id, provider: "google" } })).rejects.toThrow();
  });

  it("rechecks membership on every request, rotates workspace sessions, and preserves one active owner", async () => {
    const left = await account("authority-left"); const right = await account("authority-right");
    const shared = await db.membership.create({ data: { workspaceId: right.workspace.id, userId: left.user.id, role: "MEMBER" } });
    const switched = await rotateSessionWorkspace(sessionRequest(left.token, "POST"), right.workspace.id);
    expect(await getSessionRecord(sessionRequest(left.token))).toBeNull();
    await expect(getSessionRecord(sessionRequest(switched))).resolves.toMatchObject({ activeWorkspaceId: right.workspace.id, membershipId: shared.id });
    await db.membership.update({ where: { id: shared.id }, data: { status: "REMOVED" } });
    expect(await getSessionRecord(sessionRequest(switched))).toBeNull();

    await expect(db.membership.update({ where: { id: left.membership.id }, data: { role: "ADMIN" } })).rejects.toThrow();
    const secondOwner = await db.membership.create({ data: { workspaceId: left.workspace.id, userId: right.user.id, role: "OWNER" } });
    const rightAccess: WorkspaceAccess = { sessionId: "right", user: right.user, workspace: left.workspace, membership: secondOwner, workspaceId: left.workspace.id, role: "OWNER" };
    const outcomes = await Promise.allSettled([
      updateMembershipRole(left.access, left.membership.id, "ADMIN", "ACTIVE"),
      updateMembershipRole(rightAccess, secondOwner.id, "ADMIN", "ACTIVE"),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "rejected")).toBe(true);
    expect(await db.membership.count({ where: { workspaceId: left.workspace.id, role: "OWNER", status: "ACTIVE" } })).toBe(1);
  });

  it("blocks authority reduction while a member owns active lifecycle state or workspace Google custody", async () => {
    const owner = await account("lifecycle-owner"); const target = await account("lifecycle-target");
    const membership = await db.membership.create({ data: { workspaceId: owner.workspace.id, userId: target.user.id, role: "ADMIN" } });
    const event = await db.eventType.create({ data: { workspaceId: owner.workspace.id, ownerId: target.user.id, name: "Owned lifecycle", slug: `owned-${crypto.randomUUID()}`, durationMinutes: 30 } });
    await expect(updateMembershipRole(owner.access, membership.id, "MEMBER", "ACTIVE")).rejects.toThrow(/Transfer or close/);
    await db.eventType.update({ where: { id: event.id }, data: { isActive: false } });
    const booking = await db.booking.create({ data: { workspaceId: owner.workspace.id, eventTypeId: event.id, hostId: target.user.id, durationMinutes: 30, inviteeName: "Lifecycle", inviteeEmail: "lifecycle@example.com", inviteeTimeZone: "UTC", startAt: new Date("2099-01-01T10:00:00Z"), endAt: new Date("2099-01-01T10:30:00Z"), idempotencyKey: crypto.randomUUID(), requestFingerprint: crypto.randomUUID(), capabilityVersion: crypto.randomUUID(), manageExpiresAt: new Date("2099-02-01T00:00:00Z") } });
    await expect(updateMembershipRole(owner.access, membership.id, "MEMBER", "ACTIVE")).rejects.toThrow(/Transfer or close/);
    await db.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
    const effect = await db.integrationOutbox.create({ data: { workspaceId: owner.workspace.id, bookingId: booking.id, kind: "CALENDAR_DELETE", idempotencyKey: `lifecycle-${crypto.randomUUID()}` } });
    await expect(updateMembershipRole(owner.access, membership.id, "MEMBER", "ACTIVE")).rejects.toThrow(/Transfer or close/);
    await db.integrationOutbox.update({ where: { id: effect.id }, data: { status: "COMPLETED" } });
    await db.oAuthConnection.create({ data: { workspaceId: owner.workspace.id, userId: target.user.id, provider: "google" } });
    await expect(updateMembershipRole(owner.access, membership.id, "MEMBER", "ACTIVE")).rejects.toThrow(/Transfer or close/);
    await db.oAuthConnection.deleteMany({ where: { workspaceId: owner.workspace.id } });
    await expect(updateMembershipRole(owner.access, membership.id, "MEMBER", "ACTIVE")).resolves.toBeUndefined();
    await expect(updateMembershipRole(owner.access, membership.id, "MEMBER", "REMOVED")).resolves.toBeUndefined();
  });

  it("blocks direct and user-cascade deletion of the final owner while allowing deliberate workspace deletion", async () => {
    const created = await account("owner-delete");
    await expect(db.membership.delete({ where: { id: created.membership.id } })).rejects.toThrow();
    await expect(db.user.delete({ where: { id: created.user.id } })).rejects.toThrow();
    await expect(db.workspace.delete({ where: { id: created.workspace.id } })).resolves.toMatchObject({ id: created.workspace.id });
  });

  it("fails production startup closed without canonical HTTPS, a strong session secret, and authenticated proxy ingress", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://example.com");
    expect(() => assertProductionRuntimeSecurity()).toThrow(/canonical HTTPS/);
    vi.stubEnv("BOOKING_CAPABILITY_KEY_ID", "production-capability-v1"); vi.stubEnv("BOOKING_CAPABILITY_SECRET", "independent-booking-capability-secret-at-least-thirty-two");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/"); vi.stubEnv("AUTH_SECRET", authSecret); vi.stubEnv("DATABASE_PROVIDER", "postgresql"); vi.stubEnv("DATABASE_URL", "postgresql://app@example.com/tempocove?sslmode=verify-full&sslrootcert=/run/secrets/ca&connect_timeout=3&pool_timeout=3&statement_timeout=2000"); vi.stubEnv("MONITOR_DATABASE_URL", "postgresql://monitor@example.com/tempocove?sslmode=verify-full&sslrootcert=/run/secrets/ca"); vi.stubEnv("RATE_LIMIT_PROVIDER", "postgresql"); vi.stubEnv("RATE_LIMIT_HASH_SECRET", "rate-limit-secret-that-is-at-least-thirty-two"); vi.stubEnv("TENANT_CONTEXT_SECRET", "tenant-context-secret-that-is-at-least-thirty-two"); vi.stubEnv("TOKEN_ENCRYPTION_KEY", "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"); vi.stubEnv("OUTBOX_WORKER_MODE", "dedicated"); vi.stubEnv("PAYMENTS_PROVIDER", "stripe"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_configuration_fixture"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_configuration_fixture"); vi.stubEnv("CALENDAR_PROVIDER", "google"); vi.stubEnv("GOOGLE_CLIENT_ID", "fixture.apps.googleusercontent.com"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-client-secret-long"); vi.stubEnv("DEMO_MODE", "false"); vi.stubEnv("TRUST_PROXY", "true"); vi.stubEnv("PROXY_SHARED_SECRET", "short");
    vi.stubEnv("DATABASE_URL", "postgresql://app@example.com/tempocove?sslmode=verify-full&sslrootcert=/run/secrets/ca&connect_timeout=3&pool_timeout=20&connection_limit=20&statement_timeout=2000");
    expect(() => assertProductionRuntimeSecurity()).toThrow(/PROXY_SHARED_SECRET/);
    vi.stubEnv("PROXY_SHARED_SECRET", "proxy-secret-that-is-at-least-thirty-two-bytes"); vi.stubEnv("OPERATOR_HEALTH_SECRET", "operator-secret-that-is-at-least-thirty-two"); vi.stubEnv("EMAIL_PROVIDER", "smtp"); vi.stubEnv("EMAIL_TOKEN_SECRET", "production-email-token-secret-at-least-thirty-two"); vi.stubEnv("SMTP_HOST", "smtp.example.com"); vi.stubEnv("SMTP_PORT", "587"); vi.stubEnv("SMTP_TLS_MODE", "starttls"); vi.stubEnv("SMTP_USER", "user"); vi.stubEnv("SMTP_PASSWORD", "password"); vi.stubEnv("EMAIL_FROM", "SnagTime <mail@example.com>"); vi.stubEnv("EMAIL_REPLY_TO", "support@example.com"); vi.stubEnv("EMAIL_SENDER_DOMAIN", "example.com");
    expect(() => assertProductionRuntimeSecurity()).not.toThrow();
  });

  it("rejects environment Google custody outside one explicitly bound local demo workspace", () => {
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "environment-refresh"); vi.stubEnv("NODE_ENV", "development");
    expect(() => assertProductionRuntimeSecurity()).toThrow(/local-demo-only/);
    vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("GOOGLE_ENV_WORKSPACE_ID", "immutable-demo-workspace");
    expect(() => assertProductionRuntimeSecurity()).not.toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertProductionRuntimeSecurity()).toThrow(/local-demo-only/);
  });
});
