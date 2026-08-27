import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { db } from "@/server/db";
import { decryptToken, encryptToken } from "@/server/crypto/tokens";
import { assertRequiredGoogleScopes, clearGoogleScopeHealthCache, consumeGoogleAuthorization, createGoogleAuthorization, disconnectGoogleCalendar, environmentGoogleCredentialAllowed, evaluateGoogleScopeEvidence, evaluateGoogleScopeProbes, getCalendarService, getGoogleScopeHealth, googleCalendarStatus, googleConditionalRequestOptions, googleCreateEventRequest, googleCredentialsReady, googleDeleteEventRequest, googleEventBusyIntervals, googleEventsListRequest, googleUpdateEventRequest, GoogleCalendarService, isProviderNotFound, persistRefreshedGoogleTokens, persistVerifiedGoogleAuthorization, providerCalendarEventId, reconcileGoogleEventUpdate, REQUIRED_GOOGLE_CALENDAR_SCOPES, retryPendingGoogleDisconnects, type CalendarBooking } from "@/server/services/calendar";

const calendarTestUserIds: string[] = [];
const calendarTestWorkspaceIds: string[] = [];
async function calendarTestUser(label: string) {
  const user = await db.user.create({ data: { email: `${label}-${crypto.randomUUID()}@example.com`, name: "Calendar Test", passwordHash: "isolated-test-only" } });
  const workspace = await db.workspace.create({ data: { name: `${label} workspace`, timeZone: "America/Chicago" } });
  const membership = await db.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" } });
  calendarTestUserIds.push(user.id); calendarTestWorkspaceIds.push(workspace.id);
  return { ...user, workspaceId: workspace.id, membershipId: membership.id };
}

function googleConnectionKey(user: { id: string; workspaceId: string }) {
  return { workspaceId_provider: { workspaceId: user.workspaceId, provider: "google" } } as const;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function calendarSessionData(user: { id: string; workspaceId: string; membershipId: string }, prefix: string) {
  return { userId: user.id, activeWorkspaceId: user.workspaceId, membershipId: user.membershipId, tokenHash: `${prefix}-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) };
}

async function googleDisconnectConnection(user: { id: string; workspaceId: string }, overrides: Record<string, unknown> = {}) {
  return db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "ACTIVE", ...overrides } });
}

function verifiedAuthorization(overrides: Partial<{ accessToken: string | null; refreshToken: string | null; expiresAt: Date | null; providerUserId: string; scope: string }> = {}) {
  return {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    providerUserId: "provider-user",
    scope: REQUIRED_GOOGLE_CALENDAR_SCOPES.join(" "),
    ...overrides,
  };
}

function bookingFixture(): CalendarBooking {
  return {
    id: "booking-1", inviteeEmail: "guest@example.com", inviteeName: "Guest", notes: null,
    startAt: new Date("2099-01-01T15:00:00Z"), endAt: new Date("2099-01-01T15:30:00Z"),
    eventType: { name: "Demo", locationType: "GOOGLE_MEET" }, host: { timeZone: "America/Chicago" },
  } as CalendarBooking;
}

describe("Google Calendar notification adapter", () => {
  afterEach(async () => { vi.restoreAllMocks(); clearGoogleScopeHealthCache(); await db.workspace.deleteMany({ where: { id: { in: calendarTestWorkspaceIds.splice(0) } } }); await db.user.deleteMany({ where: { id: { in: calendarTestUserIds.splice(0) } } }); delete process.env.TOKEN_ENCRYPTION_KEY; delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN; delete process.env.GOOGLE_ENV_WORKSPACE_ID; delete process.env.DEMO_MODE; delete process.env.CALENDAR_PROVIDER; delete process.env.NEXT_PUBLIC_APP_URL; delete process.env.TEMPOCOVE_PROVIDER_PROOF_MODE; });
  it("classifies full, missing, and unavailable read-only Google scope probes", async () => {
    await expect(evaluateGoogleScopeProbes(async () => undefined, async () => undefined)).resolves.toEqual({ scopeHealth: "complete", missingScopes: [] });
    await expect(evaluateGoogleScopeProbes(async () => { throw { code: 403 }; }, async () => undefined)).resolves.toEqual({ scopeHealth: "insufficient", missingScopes: [REQUIRED_GOOGLE_CALENDAR_SCOPES[0]] });
    await expect(evaluateGoogleScopeProbes(async () => { throw { response: { status: 403 } }; }, async () => { throw { code: 401 }; })).resolves.toEqual({ scopeHealth: "insufficient", missingScopes: [...REQUIRED_GOOGLE_CALENDAR_SCOPES] });
    await expect(evaluateGoogleScopeProbes(async () => { throw new Error("network unavailable"); }, async () => undefined)).resolves.toEqual({ scopeHealth: "unavailable", missingScopes: [] });
    await expect(evaluateGoogleScopeEvidence([REQUIRED_GOOGLE_CALENDAR_SCOPES[0]], async () => undefined, async () => undefined)).resolves.toEqual({ scopeHealth: "insufficient", missingScopes: [REQUIRED_GOOGLE_CALENDAR_SCOPES[1]] });
    expect(() => assertRequiredGoogleScopes(REQUIRED_GOOGLE_CALENDAR_SCOPES[0])).toThrow(/both Calendar permissions/);
    expect(() => assertRequiredGoogleScopes(REQUIRED_GOOGLE_CALENDAR_SCOPES.join(" "))).not.toThrow();
  });

  it("caches exact scope evidence by time but rechecks current credential state before cache", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    const user = await calendarTestUser("scope-cache"); process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = user.workspaceId; let probes = 0;
    await expect(getGoogleScopeHealth(user.id, async () => { probes += 1; return { scopeHealth: "complete", missingScopes: [] }; }, 1_000, user.workspaceId)).resolves.toMatchObject({ scopeHealth: "complete" });
    await expect(getGoogleScopeHealth(user.id, async () => { probes += 1; return { scopeHealth: "insufficient", missingScopes: [...REQUIRED_GOOGLE_CALENDAR_SCOPES] }; }, 2_000, user.workspaceId)).resolves.toMatchObject({ scopeHealth: "complete" });
    expect(probes).toBe(1);
    await expect(getGoogleScopeHealth(user.id, async () => { probes += 1; return { scopeHealth: "insufficient", missingScopes: [...REQUIRED_GOOGLE_CALENDAR_SCOPES] }; }, 62_000, user.workspaceId)).resolves.toMatchObject({ scopeHealth: "insufficient" });
    expect(probes).toBe(2);
  });

  it("fails status closed to local when configured credentials have insufficient Calendar scopes", async () => {
    process.env.CALENDAR_PROVIDER = "google"; process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    const user = await calendarTestUser("scope-status"); process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = user.workspaceId;
    await expect(googleCalendarStatus(user.id, user.workspaceId, async () => ({ scopeHealth: "insufficient", missingScopes: [REQUIRED_GOOGLE_CALENDAR_SCOPES[0]] }))).resolves.toMatchObject({ connected: false, provider: "local", requestedProvider: "google", scopeHealth: "insufficient", missingScopes: [REQUIRED_GOOGLE_CALENDAR_SCOPES[0]] });
    await expect(googleCalendarStatus(user.id, user.workspaceId, async () => ({ scopeHealth: "complete", missingScopes: [] }))).resolves.toMatchObject({ connected: true, provider: "google", scopeHealth: "complete", missingScopes: [] });
  });
  it("uses a deterministic provider id and emails the invitee for creates", () => {
    const booking = { ...bookingFixture(), eventTitleSnapshot: "Accepted title", locationTypeSnapshot: "CUSTOM", locationValueSnapshot: "Accepted room" }; const eventId = providerCalendarEventId(booking.id);
    const request = googleCreateEventRequest("primary", eventId, booking);
    expect(request.sendUpdates).toBe("all");
    expect(request.requestBody.id).toBe(eventId);
    expect(request.requestBody.attendees).toEqual([{ email: "guest@example.com", displayName: "Guest" }]);
    expect(request.requestBody).toMatchObject({ summary: "Accepted title with Guest", location: "Accepted room" });
    expect(request.requestBody.conferenceData).toBeUndefined();
  });

  it("emails the same invitee for updates", () => {
    const request = googleUpdateEventRequest("primary", "provider-event", bookingFixture());
    expect(request.sendUpdates).toBe("all");
    expect(request.requestBody.attendees).toEqual([{ email: "guest@example.com", displayName: "Guest" }]);
  });

  it("uses an id-aware event listing for manage reschedule busy time", () => {
    expect(googleEventsListRequest("primary", new Date("2099-01-01Z"), new Date("2099-01-02Z"))).toMatchObject({ calendarId: "primary", singleEvents: true, showDeleted: false });
    expect(googleEventBusyIntervals([
      { id: "current", start: { dateTime: "2099-01-01T10:00:00Z" }, end: { dateTime: "2099-01-01T10:30:00Z" } },
      { id: "other", start: { dateTime: "2099-01-01T11:00:00Z" }, end: { dateTime: "2099-01-01T11:30:00Z" } },
      { id: "transparent", transparency: "transparent", start: { dateTime: "2099-01-01T12:00:00Z" }, end: { dateTime: "2099-01-01T12:30:00Z" } },
    ], "current")).toEqual([{ start: new Date("2099-01-01T11:00:00Z"), end: new Date("2099-01-01T11:30:00Z") }]);
    expect(googleEventBusyIntervals([{ id: "all-day", start: { date: "2099-01-01" }, end: { date: "2099-01-02" } }], "other", "America/Chicago")).toEqual([{ start: new Date("2099-01-01T06:00:00Z"), end: new Date("2099-01-02T06:00:00Z") }]);
    expect(googleConditionalRequestOptions('"etag-v2"')).toMatchObject({ headers: { "If-Match": '"etag-v2"' } });
  });

  it("asks Google to send cancellation updates for deletes", () => {
    expect(googleDeleteEventRequest("primary", "provider-event")).toEqual({ calendarId: "primary", eventId: "provider-event", sendUpdates: "all" });
    expect(isProviderNotFound({ code: 404 })).toBe(true);
    expect(isProviderNotFound({ code: 500 })).toBe(false);
  });

  it("retains encrypted credentials when provider revocation must retry", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const user = await calendarTestUser("disconnect");
    await db.oAuthConnection.upsert({ where: googleConnectionKey(user), update: { refreshToken: encryptToken("refresh-secret"), disconnectStatus: "ACTIVE" }, create: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("refresh-secret"), calendarId: "primary" } });
    await expect(disconnectGoogleCalendar(user.id, async () => { throw new Error("provider unavailable"); }, new Date(), user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_REVOKE_PENDING" });
    const retained = await db.oAuthConnection.findUniqueOrThrow({ where: googleConnectionKey(user) });
    expect(retained.refreshToken).toMatch(/^aesgcm:v1:/); expect(retained.disconnectStatus).toBe("REVOKE_RETRY");
    await expect(getGoogleScopeHealth(user.id, async () => ({ scopeHealth: "complete", missingScopes: [] }), 1_000, user.workspaceId)).resolves.toEqual({ scopeHealth: "unavailable", missingScopes: [...REQUIRED_GOOGLE_CALENDAR_SCOPES] });
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "pending") }); const beforeStates = await db.oAuthState.count({ where: { userId: user.id } });
    await expect(createGoogleAuthorization(user.id, authSession.id, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_REVOKE_PENDING" }); expect(await db.oAuthState.count({ where: { userId: user.id } })).toBe(beforeStates); await db.authSession.delete({ where: { id: authSession.id } });
    await db.oAuthConnection.update({ where: { id: retained.id }, data: { disconnectRetryAt: new Date("2020-01-01T00:00:00Z") } });
    expect(await retryPendingGoogleDisconnects(new Date(), async () => undefined)).toEqual({ attempted: 1, completed: 1 });
    expect(await db.oAuthConnection.findUnique({ where: { id: retained.id } })).toBeNull();
  });

  it("uses a revocation lease to fence crashes after claim", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const user = await calendarTestUser("disconnect-crash");
    const connection = await googleDisconnectConnection(user);
    const now = new Date("2099-08-01T00:00:00Z");
    await expect(disconnectGoogleCalendar(user.id, async () => {
      const claimed = await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(claimed.disconnectStatus).toBe("REVOKE_IN_PROGRESS");
      expect(claimed.disconnectLeaseToken).toBeTruthy();
      expect(claimed.disconnectLeaseExpiresAt?.getTime()).toBeGreaterThan(now.getTime());
      throw new Error("simulated crash");
    }, now, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_REVOKE_PENDING" });
    expect(await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({
      disconnectStatus: "REVOKE_RETRY",
      disconnectLeaseToken: null,
      disconnectLeaseExpiresAt: null,
      disconnectErrorCode: "GOOGLE_REVOKE_FAILED",
    });
  });

  it("blocks a concurrent revocation claim until the active lease clears", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const user = await calendarTestUser("disconnect-concurrent");
    const connection = await googleDisconnectConnection(user);
    const now = new Date("2099-08-01T00:00:00Z");
    const blocker = deferred<void>();
    let claimed = false;
    const first = disconnectGoogleCalendar(user.id, async () => { claimed = true; await blocker.promise; }, now, user.workspaceId);
    for (let i = 0; i < 40 && !claimed; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(claimed).toBe(true);
    await expect(db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({ disconnectStatus: "REVOKE_IN_PROGRESS" });
    await expect(disconnectGoogleCalendar(user.id, async () => undefined, now, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_REVOKE_PENDING" });
    blocker.resolve();
    await expect(first).resolves.toEqual({ disconnected: true });
    expect(await db.oAuthConnection.findUnique({ where: { id: connection.id } })).toBeNull();
  });

  it("reclaims a stale in-progress revocation and fences the old worker", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const user = await calendarTestUser("disconnect-stale");
    const connection = await googleDisconnectConnection(user);
    const now = new Date("2099-08-01T00:00:00Z");
    const leaseWait = deferred<void>();
    const first = disconnectGoogleCalendar(user.id, async () => { await leaseWait.promise; }, now, user.workspaceId);
    for (let i = 0; i < 40; i += 1) {
      const claimed = await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } });
      if (claimed.disconnectStatus === "REVOKE_IN_PROGRESS" && claimed.disconnectLeaseToken) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (i === 39) throw new Error("lease was not claimed");
    }
    await db.oAuthConnection.update({ where: { id: connection.id }, data: { disconnectLeaseExpiresAt: new Date("2099-07-31T23:59:59Z") } });
    expect(await retryPendingGoogleDisconnects(new Date("2099-08-01T00:10:00Z"), async () => undefined)).toEqual({ attempted: 1, completed: 1 });
    leaseWait.resolve();
    await expect(first).rejects.toMatchObject({ code: "GOOGLE_REVOKE_FENCE_LOST" });
    expect(await db.oAuthConnection.findUnique({ where: { id: connection.id } })).toBeNull();
  });

  it("retries a due revocation successfully and deletes the retained credential", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const user = await calendarTestUser("disconnect-retry-success");
    const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "REVOKE_RETRY", disconnectRetryAt: new Date("2099-07-31T00:00:00Z"), disconnectErrorCode: "GOOGLE_REVOKE_FAILED" } });
    const result = await retryPendingGoogleDisconnects(new Date("2099-08-01T00:00:00Z"), async (token) => { expect(token).toBe("refresh-secret"); });
    expect(result).toEqual({ attempted: 1, completed: 1 });
    expect(await db.oAuthConnection.findUnique({ where: { id: connection.id } })).toBeNull();
  });

  it("requeues a stale in-progress revocation when the provider still fails", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const user = await calendarTestUser("disconnect-retry-fail");
    const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "REVOKE_IN_PROGRESS", disconnectLeaseToken: "stale-lease", disconnectLeaseExpiresAt: new Date("2099-07-31T00:00:00Z") } });
    const result = await retryPendingGoogleDisconnects(new Date("2099-08-01T00:00:00Z"), async () => { throw new Error("provider unavailable"); });
    expect(result).toEqual({ attempted: 1, completed: 0 });
    expect(await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({
      disconnectStatus: "REVOKE_RETRY",
      disconnectLeaseToken: null,
      disconnectLeaseExpiresAt: null,
      disconnectErrorCode: "GOOGLE_REVOKE_FAILED",
    });
  });

  it("never persists environment refresh emissions and treats an ACTIVE blank legacy row as environment source", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.GOOGLE_REFRESH_TOKEN = "environment-refresh"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("environment-source"); process.env.DEMO_MODE = "true"; process.env.GOOGLE_ENV_WORKSPACE_ID = user.workspaceId;
    await expect(persistRefreshedGoogleTokens(user.id, { kind: "environment" }, { accessToken: "access-only", expiresAt: new Date("2099-01-01Z") })).resolves.toBe(false);
    expect(await db.oAuthConnection.count({ where: { userId: user.id } })).toBe(0);
    const blank = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: null, accessToken: null, disconnectStatus: "ACTIVE" } });
    await expect(googleCredentialsReady(user.id, user.workspaceId)).resolves.toBe(true);
    await expect(persistRefreshedGoogleTokens(user.id, { kind: "environment" }, { accessToken: "must-not-attach" })).resolves.toBe(false);
    expect(await db.oAuthConnection.findUniqueOrThrow({ where: { id: blank.id } })).toMatchObject({ accessToken: null, refreshToken: null, disconnectStatus: "ACTIVE" });
  });

  it("claims the latest DB credential before revoke and fences a concurrent refresh save", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("revoke-fence"); const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("latest-refresh"), disconnectStatus: "ACTIVE" } });
    let observedStatus: string | null = null;
    await expect(disconnectGoogleCalendar(user.id, async (token) => {
      expect(token).toBe("latest-refresh"); observedStatus = (await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).disconnectStatus;
      expect(await persistRefreshedGoogleTokens(user.id, { kind: "database", connectionId: connection.id, workspaceId: user.workspaceId, credentialUserId: user.id, credentialGeneration: connection.credentialGeneration }, { accessToken: "late-access" })).toBe(false);
    }, new Date(), user.workspaceId)).resolves.toEqual({ disconnected: true });
    expect(observedStatus).toBe("REVOKE_IN_PROGRESS"); expect(await db.oAuthConnection.findUnique({ where: { id: connection.id } })).toBeNull();
  });

  it("prevents an old OAuth state from overwriting pending, deleted, or replacement custody", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("callback-fence"); const first = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("first-refresh"), disconnectStatus: "ACTIVE" } });
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "fence") }); const authorizationUrl = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId)); const state = await db.oAuthState.findUniqueOrThrow({ where: { id: authorizationUrl.searchParams.get("state")! } }); expect(state).toMatchObject({ expectedConnectionId: first.id, expectedConnectionGeneration: first.credentialGeneration });
    const verified = { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: new Date("2099-01-01Z"), providerUserId: "provider-user", scope: REQUIRED_GOOGLE_CALENDAR_SCOPES.join(" ") };
    await db.oAuthConnection.update({ where: { id: first.id }, data: { disconnectStatus: "REVOKE_IN_PROGRESS" } });
    await expect(persistVerifiedGoogleAuthorization(user.id, first.id, first.credentialGeneration, verified, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_FENCE_LOST" });
    await db.oAuthConnection.delete({ where: { id: first.id } }); const replacement = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", refreshToken: encryptToken("replacement-refresh"), disconnectStatus: "ACTIVE" } });
    await expect(persistVerifiedGoogleAuthorization(user.id, first.id, first.credentialGeneration, verified, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_FENCE_LOST" });
    await expect(persistVerifiedGoogleAuthorization(user.id, null, null, verified, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_FENCE_LOST" });
    expect(decryptToken((await db.oAuthConnection.findUniqueOrThrow({ where: { id: replacement.id } })).refreshToken)).toBe("replacement-refresh");
  });

  it("orders same-connection callbacks and fences refreshes by credential generation", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("generation-fence"); const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", providerUserId: "provider-a", refreshToken: encryptToken("generation-zero-refresh"), accessToken: encryptToken("generation-zero-access"), disconnectStatus: "ACTIVE" } });
    const sessions = await Promise.all([0, 1].map((index) => db.authSession.create({ data: calendarSessionData(user, `generation-${index}`) })));
    const states = [];
    for (const session of sessions) { const url = new URL(await createGoogleAuthorization(user.id, session.id, user.workspaceId)); states.push(await db.oAuthState.findUniqueOrThrow({ where: { id: url.searchParams.get("state")! } })); }
    expect(states.map((state) => state.expectedConnectionGeneration)).toEqual([0, 0]);
    const firstVerified = { accessToken: "generation-one-access", refreshToken: "generation-one-refresh", expiresAt: new Date("2099-01-01Z"), providerUserId: "provider-a", scope: REQUIRED_GOOGLE_CALENDAR_SCOPES.join(" ") };
    await persistVerifiedGoogleAuthorization(user.id, connection.id, states[0]!.expectedConnectionGeneration, firstVerified, user.workspaceId);
    await expect(persistVerifiedGoogleAuthorization(user.id, connection.id, states[1]!.expectedConnectionGeneration, { ...firstVerified, accessToken: "out-of-order-access" }, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_FENCE_LOST" });
    await expect(persistRefreshedGoogleTokens(user.id, { kind: "database", connectionId: connection.id, workspaceId: user.workspaceId, credentialUserId: user.id, credentialGeneration: 0 }, { accessToken: "late-generation-zero-access" })).resolves.toBe(false);
    let current = await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } }); expect(current.credentialGeneration).toBe(1); expect(decryptToken(current.accessToken)).toBe("generation-one-access");
    await expect(persistVerifiedGoogleAuthorization(user.id, connection.id, 1, { ...firstVerified, accessToken: "wrong-identity-access", refreshToken: null, providerUserId: "provider-b" }, user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_SUBJECT_REPLACEMENT_REQUIRES_DISCONNECT" });
    await persistVerifiedGoogleAuthorization(user.id, connection.id, 1, { ...firstVerified, accessToken: "same-identity-access", refreshToken: null }, user.workspaceId);
    current = await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } }); expect(current.credentialGeneration).toBe(2); expect(decryptToken(current.refreshToken)).toBe("generation-zero-refresh"); expect(decryptToken(current.accessToken)).toBe("same-identity-access");
  });

  it("keeps Google OAuth callback finalize atomic if the last commit step crashes", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("callback-atomic-crash");
    const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", providerUserId: "provider-user", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "ACTIVE", credentialGeneration: 0 } });
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "callback-atomic-crash") });
    const authorizationUrl = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId));
    const stateId = authorizationUrl.searchParams.get("state")!;
    const exchange = vi.spyOn(GoogleCalendarService.prototype, "exchangeAuthorizationCode").mockResolvedValue(verifiedAuthorization());
    await expect(consumeGoogleAuthorization(user.id, authSession.id, stateId, "authorization-code", { afterPersist: async () => { throw new Error("simulated crash"); } })).rejects.toThrow("simulated crash");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(decryptToken((await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).refreshToken)).toBe("refresh-secret");
    expect(await db.oAuthState.findUniqueOrThrow({ where: { id: stateId } })).toMatchObject({ consumedAt: null, processingToken: null, processingExpiresAt: null });
    exchange.mockRestore();
  });

  it("revalidates the live admin session before finalize and fails closed when it expires", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("callback-demotion");
    const coOwner = await db.user.create({ data: { email: `callback-demotion-coowner-${crypto.randomUUID()}@example.com`, name: "Calendar Co-Owner", passwordHash: "isolated-test-only" } });
    await db.membership.create({ data: { workspaceId: user.workspaceId, userId: coOwner.id, role: "OWNER" } });
    await db.membership.update({ where: { id: user.membershipId }, data: { role: "ADMIN" } });
    const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", providerUserId: "provider-user", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "ACTIVE", credentialGeneration: 0 } });
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "callback-demotion") });
    const authorizationUrl = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId));
    const stateId = authorizationUrl.searchParams.get("state")!;
    const exchange = vi.spyOn(GoogleCalendarService.prototype, "exchangeAuthorizationCode").mockResolvedValue(verifiedAuthorization());
    await expect(consumeGoogleAuthorization(user.id, authSession.id, stateId, "authorization-code", { beforeFinalize: async () => { await db.authSession.update({ where: { id: authSession.id }, data: { expiresAt: new Date(Date.now() - 1_000) } }); } })).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_FENCE_LOST" });
    expect(decryptToken((await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).refreshToken)).toBe("refresh-secret");
    expect(await db.oAuthState.findUniqueOrThrow({ where: { id: stateId } })).toMatchObject({ consumedAt: null, processingToken: null, processingExpiresAt: null });
    exchange.mockRestore();
  });

  it("rejects stale processing tokens before a callback can reclaim the state", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("callback-stale-token");
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "callback-stale-token") });
    const stateUrl = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId));
    const stateId = stateUrl.searchParams.get("state")!;
    const exchange = vi.spyOn(GoogleCalendarService.prototype, "exchangeAuthorizationCode").mockResolvedValue(verifiedAuthorization());
    await expect(consumeGoogleAuthorization(user.id, authSession.id, stateId, "authorization-code", { beforeFinalize: async () => { await db.oAuthState.update({ where: { id: stateId }, data: { processingToken: "stale-token", processingExpiresAt: new Date("2099-01-01T00:05:00Z") } }); } })).rejects.toThrow("Google OAuth state is already being processed.");
    expect(exchange).toHaveBeenCalledTimes(1);
    exchange.mockRestore();
  });

  it("rejects a subject swap racing the callback finalize", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("callback-subject-race");
    const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", providerUserId: "provider-user", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "ACTIVE", credentialGeneration: 0 } });
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "callback-subject-race") });
    const authorizationUrl = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId));
    const stateId = authorizationUrl.searchParams.get("state")!;
    const exchange = vi.spyOn(GoogleCalendarService.prototype, "exchangeAuthorizationCode").mockResolvedValue(verifiedAuthorization());
    await expect(consumeGoogleAuthorization(user.id, authSession.id, stateId, "authorization-code", { beforeFinalize: async () => { await db.oAuthConnection.update({ where: { id: connection.id }, data: { providerUserId: "other-subject" } }); } })).rejects.toMatchObject({ code: "GOOGLE_SUBJECT_REPLACEMENT_REQUIRES_DISCONNECT" });
    expect(decryptToken((await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).refreshToken)).toBe("refresh-secret");
    exchange.mockRestore();
  });

  it("rejects a generation race racing the callback finalize", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const user = await calendarTestUser("callback-generation-race");
    const connection = await db.oAuthConnection.create({ data: { workspaceId: user.workspaceId, userId: user.id, provider: "google", providerUserId: "provider-user", refreshToken: encryptToken("refresh-secret"), disconnectStatus: "ACTIVE", credentialGeneration: 0 } });
    const authSession = await db.authSession.create({ data: calendarSessionData(user, "callback-generation-race") });
    const authorizationUrl = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId));
    const stateId = authorizationUrl.searchParams.get("state")!;
    const exchange = vi.spyOn(GoogleCalendarService.prototype, "exchangeAuthorizationCode").mockResolvedValue(verifiedAuthorization());
    await expect(consumeGoogleAuthorization(user.id, authSession.id, stateId, "authorization-code", { beforeFinalize: async () => { await db.oAuthConnection.update({ where: { id: connection.id }, data: { credentialGeneration: 1 } }); } })).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_FENCE_LOST" });
    expect(decryptToken((await db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).refreshToken)).toBe("refresh-secret");
    exchange.mockRestore();
  });

  it("treats Google custody as workspace-owned while requiring live administrator authority", async () => {
    process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    const connector = await calendarTestUser("workspace-connector"); const administrator = await calendarTestUser("workspace-admin");
    const adminMembership = await db.membership.create({ data: { workspaceId: connector.workspaceId, userId: administrator.id, role: "ADMIN" } });
    const connection = await db.oAuthConnection.create({ data: { workspaceId: connector.workspaceId, userId: connector.id, provider: "google", providerUserId: "provider-a", refreshToken: encryptToken("connector-refresh"), disconnectStatus: "ACTIVE" } });
    await expect(googleCredentialsReady(administrator.id, connector.workspaceId)).resolves.toBe(true);
    const verified = { accessToken: "admin-access", refreshToken: "admin-refresh", expiresAt: new Date("2099-01-01Z"), providerUserId: "provider-b", scope: REQUIRED_GOOGLE_CALENDAR_SCOPES.join(" ") };
    await expect(persistVerifiedGoogleAuthorization(administrator.id, connection.id, connection.credentialGeneration, verified, connector.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_SUBJECT_REPLACEMENT_REQUIRES_DISCONNECT" });
    await expect(db.oAuthConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({ userId: connector.id, providerUserId: "provider-a", credentialGeneration: 0 });
    await expect(disconnectGoogleCalendar(administrator.id, async (token) => { expect(token).toBe("connector-refresh"); }, new Date(), connector.workspaceId)).resolves.toEqual({ disconnected: true });
    await persistVerifiedGoogleAuthorization(administrator.id, null, null, verified, connector.workspaceId);
    const replacement = await db.oAuthConnection.findUniqueOrThrow({ where: googleConnectionKey({ id: administrator.id, workspaceId: connector.workspaceId }) });
    expect(replacement).toMatchObject({ userId: administrator.id, providerUserId: "provider-b", credentialGeneration: 1 });
    await expect(disconnectGoogleCalendar(connector.id, async (token) => { expect(token).toBe("admin-refresh"); }, new Date(), connector.workspaceId)).resolves.toEqual({ disconnected: true });

    const adminSession = await db.authSession.create({ data: { userId: administrator.id, activeWorkspaceId: connector.workspaceId, membershipId: adminMembership.id, tokenHash: `workspace-admin-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) } });
    const prepared = new URL(await createGoogleAuthorization(administrator.id, adminSession.id, connector.workspaceId));
    expect(await db.oAuthState.findUnique({ where: { id: prepared.searchParams.get("state")! } })).toMatchObject({ workspaceId: connector.workspaceId, userId: administrator.id });
    await db.membership.update({ where: { id: adminMembership.id }, data: { role: "MEMBER" } });
    await expect(createGoogleAuthorization(administrator.id, adminSession.id, connector.workspaceId)).rejects.toThrow();
    await expect(persistVerifiedGoogleAuthorization(administrator.id, null, null, verified, connector.workspaceId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("binds environment Google custody to exactly one local-demo workspace", async () => {
    process.env.CALENDAR_PROVIDER = "google"; process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret"; process.env.GOOGLE_REFRESH_TOKEN = "environment-refresh"; process.env.DEMO_MODE = "true";
    const bound = await calendarTestUser("environment-bound"); const other = await calendarTestUser("environment-other"); process.env.GOOGLE_ENV_WORKSPACE_ID = bound.workspaceId;
    expect(environmentGoogleCredentialAllowed(bound.workspaceId)).toBe(true); expect(environmentGoogleCredentialAllowed(other.workspaceId)).toBe(false);
    await expect(googleCredentialsReady(bound.id, bound.workspaceId)).resolves.toBe(true);
    await expect(googleCredentialsReady(other.id, other.workspaceId)).resolves.toBe(false);
    await expect(googleCalendarStatus(other.id, other.workspaceId)).resolves.toMatchObject({ connected: false, provider: "local", credentialSource: "none" });
    await expect(getCalendarService().getBusyIntervals(other.id, new Date("2099-01-01Z"), new Date("2099-01-02Z"), other.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
    await expect(getCalendarService().createBookingEvent({ ...bookingFixture(), workspaceId: other.workspaceId, hostId: other.id, calendarProviderSnapshot: "google" })).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
    vi.stubEnv("NODE_ENV", "production");
    expect(environmentGoogleCredentialAllowed(bound.workspaceId)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("enforces administrator custody below the OAuth service transaction", async () => {
    const owner = await calendarTestUser("trigger-owner"); const member = await calendarTestUser("trigger-member");
    const memberRole = await db.membership.create({ data: { workspaceId: owner.workspaceId, userId: member.id, role: "MEMBER" } });
    await expect(db.oAuthConnection.create({ data: { workspaceId: owner.workspaceId, userId: member.id, provider: "google", providerUserId: "provider-member", refreshToken: "test", disconnectStatus: "ACTIVE" } })).rejects.toThrow();
    const connection = await db.oAuthConnection.create({ data: { workspaceId: owner.workspaceId, userId: owner.id, provider: "google", providerUserId: "provider-owner", refreshToken: "test", disconnectStatus: "ACTIVE" } });
    await expect(db.oAuthConnection.update({ where: { id: connection.id }, data: { userId: member.id } })).rejects.toThrow();
    await db.membership.update({ where: { id: memberRole.id }, data: { role: "ADMIN" } });
    await expect(db.oAuthConnection.update({ where: { id: connection.id }, data: { userId: member.id } })).resolves.toMatchObject({ userId: member.id });
    await db.membership.update({ where: { id: memberRole.id }, data: { role: "MEMBER" } });
    await expect(db.oAuthConnection.update({ where: { id: connection.id }, data: { accessToken: "late-token" } })).rejects.toThrow();
  });

  it("halts the OAuth custody upgrade before guards can strand a member-owned credential", () => {
    const migration = readFileSync("prisma/migrations/202608210020_oauth_admin_custody/migration.sql", "utf8");
    const schema = `
      CREATE TABLE "Membership" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT,"userId" TEXT,"status" TEXT,"role" TEXT);
      CREATE TABLE "OAuthConnection" ("workspaceId" TEXT,"userId" TEXT);
      CREATE TABLE "AuthSession" ("id" TEXT PRIMARY KEY,"activeWorkspaceId" TEXT,"userId" TEXT,"membershipId" TEXT,"revokedAt" TEXT);
      CREATE TABLE "OAuthState" ("workspaceId" TEXT,"userId" TEXT,"authSessionId" TEXT,"consumedAt" TEXT);
      INSERT INTO "Membership" VALUES ('member','workspace','user','ACTIVE','MEMBER');
      INSERT INTO "OAuthConnection" VALUES ('workspace','user');`;
    const invalid = new DatabaseSync(":memory:");
    try {
      invalid.exec(schema); expect(() => invalid.exec(migration)).toThrow();
      expect(invalid.prepare(`SELECT count(*) AS count FROM sqlite_temp_master WHERE type='table' AND name='__oauth_admin_custody_preflight'`).get()).toMatchObject({ count: 1 });
      invalid.exec(`UPDATE "Membership" SET "role"='ADMIN' WHERE "id"='member'`);
      expect(() => invalid.exec(migration)).not.toThrow();
      expect(invalid.prepare(`SELECT count(*) AS count FROM sqlite_temp_master WHERE type='table' AND name='__oauth_admin_custody_preflight'`).get()).toMatchObject({ count: 0 });
    }
    finally { invalid.close(); }

    const valid = new DatabaseSync(":memory:");
    try {
      valid.exec(schema.replace("'MEMBER'", "'ADMIN'")); valid.exec(migration);
      valid.exec(`UPDATE "Membership" SET "role"='MEMBER' WHERE "id"='member'`);
      expect(() => valid.exec(`UPDATE "OAuthConnection" SET "userId"='user'`)).toThrow();
    } finally { valid.close(); }
  });

  it("uses local busy data only when explicitly configured locally outside production", async () => {
    process.env.CALENDAR_PROVIDER = "local";
    const user = await calendarTestUser("fallback");
    expect(await getCalendarService().getBusyIntervals(user.id, new Date("2099-01-01Z"), new Date("2099-01-02Z"), user.workspaceId)).toEqual([]);
    process.env.CALENDAR_PROVIDER = "google"; process.env.GOOGLE_CLIENT_ID = "client"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    await expect(getCalendarService().getBusyIntervals(user.id, new Date("2099-01-01Z"), new Date("2099-01-02Z"), user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
  });

  it("restricts the Google provider fake to an explicit loopback production-path proof", async () => {
    process.env.TEMPOCOVE_PROVIDER_PROOF_MODE = "true"; vi.stubEnv("NODE_ENV", "production"); process.env.NEXT_PUBLIC_APP_URL = "https://production.example.com"; process.env.CALENDAR_PROVIDER = "google";
    const user = await calendarTestUser("proof-mode");
    await expect(getCalendarService().getBusyIntervals(user.id, new Date("2099-01-01Z"), new Date("2099-01-02Z"), user.workspaceId)).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
    vi.unstubAllEnvs();
  });

  it("never readiness-falls an accepted Google booking mutation back to local", async () => {
    process.env.CALENDAR_PROVIDER = "local";
    const user = await calendarTestUser("strict-mutation"); const booking = { ...bookingFixture(), hostId: user.id, calendarProviderSnapshot: "google" };
    await expect(getCalendarService().createBookingEvent(booking)).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
    await expect(getCalendarService().updateBookingEvent({ ...booking, externalCalendarEventId: "provider-event" })).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
    await expect(getCalendarService().deleteBookingEvent({ ...booking, externalCalendarEventId: "provider-event" })).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
    await expect(getCalendarService().getBusyIntervalsExcludingEvent?.(user.id, new Date("2099-01-01Z"), new Date("2099-01-02Z"), providerCalendarEventId(booking.id), "google")).rejects.toMatchObject({ code: "GOOGLE_CALENDAR_RETRY" });
  });

  it("refetches and conditionally patches after GET 404 and deterministic create conflict", async () => {
    let gets = 0; let creates = 0; let patchedWith: string | null = null;
    const result = await reconcileGoogleEventUpdate("deterministic-event", async () => { gets += 1; if (gets === 1) throw { code: 404 }; return '"etag-after-conflict"'; }, async () => { creates += 1; return { disposition: "conflict" }; }, async (etag) => { patchedWith = etag; return '"etag-current"'; });
    expect({ gets, creates, patchedWith, result }).toEqual({ gets: 2, creates: 1, patchedWith: '"etag-after-conflict"', result: { eventId: "deterministic-event", etag: '"etag-current"' } });
    let freshPatches = 0;
    await expect(reconcileGoogleEventUpdate("fresh-event", async () => { throw { code: 404 }; }, async () => ({ disposition: "created", etag: '"fresh-etag"' }), async () => { freshPatches += 1; return null; })).resolves.toEqual({ eventId: "fresh-event", etag: '"fresh-etag"' });
    expect(freshPatches).toBe(0);
  });

  it("stores PKCE verifier and nonce only in encrypted envelopes", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100";
    process.env.GOOGLE_CLIENT_ID = "google-test-client.apps.example"; process.env.GOOGLE_CLIENT_SECRET = "google-test-secret"; process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const user = await calendarTestUser("pkce"); const authSession = await db.authSession.create({ data: calendarSessionData(user, "test") });
    const url = new URL(await createGoogleAuthorization(user.id, authSession.id, user.workspaceId)); const stateId = url.searchParams.get("state")!;
    const stored = await db.oAuthState.findUniqueOrThrow({ where: { id: stateId } });
    expect(stored.codeVerifier).toMatch(/^aesgcm:v1:/); expect(stored.nonce).toMatch(/^aesgcm:v1:/);
    expect(url.searchParams.get("nonce")).toBe(decryptToken(stored.nonce)); expect(decryptToken(stored.codeVerifier)).toHaveLength(64);
    await db.oAuthState.delete({ where: { id: stateId } }); await db.authSession.delete({ where: { id: authSession.id } });
  });
});
