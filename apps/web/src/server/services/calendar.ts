import { createHash, randomBytes } from "node:crypto";
import { Prisma, type Booking, type EventType, type OAuthConnection, type User } from "@prisma/client";
import { CodeChallengeMethod } from "google-auth-library";
import { google } from "googleapis";
import { DateTime } from "luxon";
import { db } from "@/server/db";
import { currentDatabaseContext, enterDatabaseAction, runWithDatabaseContext, runWithWorkspaceRead } from "@/server/db-context";
import { decryptToken, encryptToken } from "@/server/crypto/tokens";
import { AppError } from "@/server/errors";
import type { BusyInterval } from "@/server/services/availability";

export type CalendarBooking = Booking & { eventType: EventType; host: Pick<User,"id"|"name"|"email"|"timeZone"> };
export const CALENDAR_PROVIDER_TIMEOUT_MS = 15_000;
export type CalendarMutationResult = { eventId: string; etag?: string | null };
export type CalendarCreateResult = CalendarMutationResult & { disposition: "created" | "conflict" };
export type CalendarDeleteResult = { eventId: string; providerAbsent: boolean };
export const REQUIRED_GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events"] as const;
export type GoogleScopeHealth = { scopeHealth: "complete" | "insufficient" | "unavailable"; missingScopes: string[] };
const GOOGLE_REVOKE_LEASE_MS = 60_000;
const GOOGLE_SCOPE_HEALTH_TTL_MS = 60_000;
const googleScopeHealthCache = new Map<string, { expiresAt: number; value: GoogleScopeHealth }>();

export function environmentGoogleCredentialAllowed(workspaceId: string) {
  return process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true"
    && Boolean(process.env.GOOGLE_REFRESH_TOKEN) && process.env.GOOGLE_ENV_WORKSPACE_ID === workspaceId;
}

function isGoogleAuthorizationFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  return candidate.code === 401 || candidate.code === 403 || candidate.response?.status === 401 || candidate.response?.status === 403;
}

export async function evaluateGoogleScopeProbes(freebusyProbe: () => Promise<unknown>, eventsProbe: () => Promise<unknown>): Promise<GoogleScopeHealth> {
  const [freebusy, events] = await Promise.allSettled([freebusyProbe(), eventsProbe()]);
  if (freebusy.status === "fulfilled" && events.status === "fulfilled") return { scopeHealth: "complete", missingScopes: [] };
  const missingScopes = [
    ...(freebusy.status === "rejected" && isGoogleAuthorizationFailure(freebusy.reason) ? [REQUIRED_GOOGLE_CALENDAR_SCOPES[0]] : []),
    ...(events.status === "rejected" && isGoogleAuthorizationFailure(events.reason) ? [REQUIRED_GOOGLE_CALENDAR_SCOPES[1]] : []),
  ];
  return missingScopes.length ? { scopeHealth: "insufficient", missingScopes } : { scopeHealth: "unavailable", missingScopes: [] };
}

export function missingRequiredGoogleScopes(grantedScopes: readonly string[]) {
  const granted = new Set(grantedScopes); return REQUIRED_GOOGLE_CALENDAR_SCOPES.filter((scope) => !granted.has(scope));
}
export function assertRequiredGoogleScopes(grantedScopeText: string | null | undefined) {
  const missingScopes = missingRequiredGoogleScopes((grantedScopeText || "").split(/\s+/).filter(Boolean));
  if (missingScopes.length) throw new AppError("GOOGLE_SCOPE_INSUFFICIENT", "Google did not grant every required Calendar capability. Reconnect and approve both Calendar permissions.", 400);
}
export async function evaluateGoogleScopeEvidence(grantedScopes: readonly string[], freebusyProbe: () => Promise<unknown>, eventsProbe: () => Promise<unknown>): Promise<GoogleScopeHealth> {
  const probeHealth = await evaluateGoogleScopeProbes(freebusyProbe, eventsProbe); const exactMissing = missingRequiredGoogleScopes(grantedScopes);
  if (exactMissing.length) return { scopeHealth: "insufficient", missingScopes: [...new Set([...exactMissing, ...probeHealth.missingScopes])] };
  return probeHealth;
}

async function boundedGoogleOperation<T>(operation: Promise<T>) {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("GOOGLE_SCOPE_PROBE_TIMEOUT")), CALENDAR_PROVIDER_TIMEOUT_MS); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export interface CalendarService {
  getBusyIntervals(userId: string, timeMin: Date, timeMax: Date, workspaceId?: string): Promise<BusyInterval[]>;
  getBusyIntervalsExcludingEvent?(userId: string, timeMin: Date, timeMax: Date, excludedEventId: string, requiredProvider?: "google" | "local", workspaceId?: string): Promise<BusyInterval[]>;
  createBookingEvent(booking: CalendarBooking): Promise<string | CalendarCreateResult | null>;
  updateBookingEvent(booking: CalendarBooking): Promise<void | CalendarMutationResult>;
  deleteBookingEvent(booking: CalendarBooking): Promise<void | CalendarDeleteResult>;
  providerKind?(userId: string, workspaceId?: string): Promise<"google" | "local">;
  candidateEventId?(booking: CalendarBooking): Promise<string | null>;
}

export class LocalCalendarService implements CalendarService {
  async getBusyIntervals() { return []; }
  async getBusyIntervalsExcludingEvent() { return []; }
  async createBookingEvent() { return null; }
  async updateBookingEvent() {}
  async deleteBookingEvent() {}
  async providerKind() { return "local" as const; }
  async candidateEventId() { return null; }
}

function providerProofMode() {
  if (process.env.TEMPOCOVE_PROVIDER_PROOF_MODE !== "true") return false;
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
  if (process.env.NODE_ENV !== "production" || !["localhost","127.0.0.1"].includes(origin.hostname)) throw new Error("Provider proof mode is restricted to an isolated loopback production-path test.");
  return true;
}

class ProofGoogleCalendarService implements CalendarService {
  async getBusyIntervals() { return []; }
  async getBusyIntervalsExcludingEvent() { return []; }
  async createBookingEvent(booking: CalendarBooking) { return { eventId: providerCalendarEventId(booking.id), disposition: "created" as const }; }
  async updateBookingEvent(booking: CalendarBooking) { return { eventId: booking.externalCalendarEventId || providerCalendarEventId(booking.id) }; }
  async deleteBookingEvent(booking: CalendarBooking) { return { eventId: booking.externalCalendarEventId || providerCalendarEventId(booking.id), providerAbsent: false }; }
  async providerKind() { return "google" as const; }
  async candidateEventId(booking: CalendarBooking) { return providerCalendarEventId(booking.id); }
}

type StoredGoogleCredential = Pick<OAuthConnection,"id"|"workspaceId"|"userId"|"accessToken"|"refreshToken"|"expiresAt"|"calendarId"|"credentialGeneration"|"disconnectStatus">;
type GoogleCredentialStore = { get(userId: string, workspaceId?: string): Promise<StoredGoogleCredential | null> };

function publicGoogleEventId() {
  const context = currentDatabaseContext();
  return context?.mode === "public" && context.workspaceId ? context.subject?.split("|", 1)[0] || null : null;
}

async function publicGoogleReady() {
  const eventId = publicGoogleEventId();
  if (!eventId || process.env.DATABASE_PROVIDER !== "postgresql" || process.env.NODE_ENV !== "production") return null;
  const rows = await db.$queryRawUnsafe<Array<{ ready: boolean }>>("SELECT tempocove_public_google_ready($1::text) AS ready", eventId);
  return rows[0]?.ready === true;
}

const googleRoleRank = { MEMBER: 1, ADMIN: 2, OWNER: 3 } as const;
async function liveWorkspaceMember(userId: string, workspaceId: string, minimumRole: keyof typeof googleRoleRank = "MEMBER") {
  const membership = await db.membership.findFirst({ where: { userId, workspaceId, status: "ACTIVE" }, select: { role: true } });
  return membership && googleRoleRank[membership.role as keyof typeof googleRoleRank] >= googleRoleRank[minimumRole] ? membership : null;
}

const prismaCredentialStore: GoogleCredentialStore = {
  get: async (userId, workspaceId) => {
    const eventId = publicGoogleEventId();
    if (eventId) {
      const rows = await db.$queryRawUnsafe<Array<{ connection_id: string; workspace_id: string; credential_user_id: string; access_token: string | null; refresh_token: string | null; expires_at: Date | null; calendar_id: string; credential_generation: number; disconnect_status: string }>>("SELECT * FROM tempocove_public_google_credential($1::text)", eventId);
      const stored = rows[0];
      return stored ? { id: stored.connection_id, workspaceId: stored.workspace_id, userId: stored.credential_user_id, accessToken: decryptToken(stored.access_token), refreshToken: decryptToken(stored.refresh_token), expiresAt: stored.expires_at, calendarId: stored.calendar_id, credentialGeneration: stored.credential_generation, disconnectStatus: stored.disconnect_status } : null;
    }
    if (!workspaceId) throw new Error("GOOGLE_WORKSPACE_AUTHORITY_REQUIRED");
    return runWithWorkspaceRead(userId, workspaceId, async () => {
      if (!await liveWorkspaceMember(userId, workspaceId)) throw new Error("GOOGLE_WORKSPACE_AUTHORITY_REQUIRED");
      const stored = await db.oAuthConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "google" } } });
      if (stored && !await liveWorkspaceMember(stored.userId, workspaceId, "ADMIN")) throw new Error("GOOGLE_CREDENTIAL_OWNER_NOT_ACTIVE");
      return stored ? { ...stored, accessToken: decryptToken(stored.accessToken), refreshToken: decryptToken(stored.refreshToken) } : null;
    });
  },
};

type RefreshedGoogleTokens = { accessToken?: string | null; refreshToken?: string | null; expiresAt?: Date | null };
export async function persistRefreshedGoogleTokens(userId: string, source: { kind: "environment" } | { kind: "database"; connectionId: string; workspaceId: string; credentialUserId: string; credentialGeneration: number }, tokens: RefreshedGoogleTokens) {
  if (source.kind === "environment") return false;
  const eventId = publicGoogleEventId();
  if (eventId) {
    const rows = await db.$queryRawUnsafe<Array<{ saved: boolean }>>("SELECT tempocove_public_google_refresh($1::text,$2::text,$3::integer,$4::text,$5::text,$6::timestamp) AS saved", eventId, source.connectionId, source.credentialGeneration, tokens.accessToken ? encryptToken(tokens.accessToken) : null, tokens.refreshToken ? encryptToken(tokens.refreshToken) : null, tokens.expiresAt ?? null);
    if (rows[0]?.saved) clearGoogleScopeHealthCache(source.workspaceId);
    return rows[0]?.saved === true;
  }
  const current = currentDatabaseContext();
  return runWithDatabaseContext({
    mode: current?.mode === "public" ? "public" : "workspace",
    workspaceId: source.workspaceId,
    userId: source.credentialUserId,
    sessionHash: current?.sessionHash,
    subject: current?.subject || "ADMIN",
    action: "oauth_write",
  }, async () => {
    if (!await liveWorkspaceMember(userId, source.workspaceId) || !await liveWorkspaceMember(source.credentialUserId, source.workspaceId, "ADMIN")) return false;
    const saved = await db.oAuthConnection.updateMany({ where: { id: source.connectionId, workspaceId: source.workspaceId, userId: source.credentialUserId, provider: "google", disconnectStatus: "ACTIVE", credentialGeneration: source.credentialGeneration }, data: { accessToken: tokens.accessToken ? encryptToken(tokens.accessToken) : undefined, refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined, expiresAt: tokens.expiresAt } });
    if (saved.count === 1) clearGoogleScopeHealthCache(source.workspaceId);
    return saved.count === 1;
  });
}

export class GoogleCalendarService implements CalendarService {
  constructor(private readonly credentials: GoogleCredentialStore = prismaCredentialStore) {}

  authorizationUrl(state: string, codeChallenge: string, nonce: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Calendar credentials are not configured.");
    const auth = new google.auth.OAuth2(clientId, clientSecret, `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/google/callback`);
    return auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      scope: ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events"],
    });
  }

  async exchangeAuthorizationCode(userId: string, code: string, codeVerifier: string, nonce: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Calendar credentials are not configured.");
    const auth = new google.auth.OAuth2(clientId, clientSecret, `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/google/callback`);
    let tokens;
    try { ({ tokens } = await auth.getToken({ code, codeVerifier })); }
    catch { throw new AppError("INVALID_OAUTH_CALLBACK", "Google authorization expired or was already used. Start again from Integrations.", 400); }
    assertRequiredGoogleScopes(tokens.scope);
    if (!tokens.id_token) throw new AppError("INVALID_OAUTH_CALLBACK", "Google did not return a verifiable identity token. Start again from Integrations.", 400);
    const ticket = await auth.verifyIdToken({ idToken: tokens.id_token, audience: clientId }); const identity = ticket.getPayload();
    if (!identity?.sub || identity.nonce !== nonce) throw new AppError("INVALID_OAUTH_CALLBACK", "Google identity did not match the authorization request. Start again from Integrations.", 400);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null, providerUserId: identity.sub, scope: tokens.scope! };
  }

  private async client(userId: string, workspaceId?: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Calendar credentials are not configured.");
    const stored = await this.credentials.get(userId, workspaceId);
    if (stored && stored.disconnectStatus !== "ACTIVE") throw new Error("GOOGLE_CREDENTIAL_NOT_ACTIVE");
    if (stored?.workspaceId) enterDatabaseAction("oauth_write", { workspaceId: stored.workspaceId, userId: stored.userId, subject: "ADMIN" });
    const source = stored?.refreshToken ? { kind: "database" as const, connectionId: stored.id, workspaceId: stored.workspaceId, credentialUserId: stored.userId, credentialGeneration: stored.credentialGeneration } : { kind: "environment" as const };
    const refreshToken = source.kind === "database" ? stored!.refreshToken : workspaceId && environmentGoogleCredentialAllowed(workspaceId) ? process.env.GOOGLE_REFRESH_TOKEN : undefined;
    if (!refreshToken) throw new Error("Google Calendar refresh token is not configured.");
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({
      refresh_token: refreshToken,
      access_token: source.kind === "database" ? stored?.accessToken || undefined : undefined,
      expiry_date: source.kind === "database" ? stored?.expiresAt?.getTime() : undefined,
    });
    let tokenSave = Promise.resolve();
    auth.on("tokens", (tokens) => {
      tokenSave = tokenSave.then(async () => { const saved = await persistRefreshedGoogleTokens(userId, source, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      }); if (source.kind === "database" && !saved) throw new Error("GOOGLE_CREDENTIAL_FENCE_LOST"); });
    });
    return { auth, calendar: google.calendar({ version: "v3", auth }), calendarId: stored?.calendarId || process.env.GOOGLE_CALENDAR_ID || "primary", flushTokens: () => tokenSave };
  }

  async getBusyIntervals(userId: string, timeMin: Date, timeMax: Date, workspaceId?: string) {
    const { calendar, calendarId, flushTokens } = await this.client(userId, workspaceId);
    try {
      const response = await calendar.freebusy.query({ requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] } }, { timeout: CALENDAR_PROVIDER_TIMEOUT_MS });
      return (response.data.calendars?.[calendarId]?.busy || []).flatMap((item) => item.start && item.end ? [{ start: new Date(item.start), end: new Date(item.end) }] : []);
    } finally { await flushTokens(); }
  }

  async scopeHealth(userId: string, workspaceId?: string): Promise<GoogleScopeHealth> {
    const { auth, calendar, calendarId, flushTokens } = await this.client(userId, workspaceId); const now = new Date(); const until = new Date(now.getTime() + 60_000);
    try {
      const tokenResult = await boundedGoogleOperation(auth.getAccessToken()); const accessToken = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
      if (!accessToken) return { scopeHealth: "unavailable", missingScopes: [] };
      const tokenInfo = await boundedGoogleOperation(auth.getTokenInfo(accessToken));
      return await evaluateGoogleScopeEvidence(tokenInfo.scopes || [],
        () => calendar.freebusy.query({ requestBody: { timeMin: now.toISOString(), timeMax: until.toISOString(), items: [{ id: calendarId }] } }, { timeout: CALENDAR_PROVIDER_TIMEOUT_MS }),
        () => calendar.events.list({ calendarId, timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: true, maxResults: 1 }, { timeout: CALENDAR_PROVIDER_TIMEOUT_MS }),
      );
    } finally { await flushTokens(); }
  }

  async getBusyIntervalsExcludingEvent(userId: string, timeMin: Date, timeMax: Date, excludedEventId: string, _requiredProvider?: "google" | "local", workspaceId?: string) {
    const { calendar, calendarId, flushTokens } = await this.client(userId, workspaceId);
    try {
      const events: GoogleBusyEvent[] = []; let pageToken: string | undefined; let calendarTimeZone = "UTC";
      for (let page = 0; page < 20; page += 1) {
        const response = await calendar.events.list(googleEventsListRequest(calendarId, timeMin, timeMax, pageToken), { timeout: CALENDAR_PROVIDER_TIMEOUT_MS });
        events.push(...(response.data.items ?? [])); pageToken = response.data.nextPageToken ?? undefined; calendarTimeZone = response.data.timeZone || calendarTimeZone;
        if (!pageToken) return googleEventBusyIntervals(events, excludedEventId, calendarTimeZone);
      }
      throw new Error("GOOGLE_BUSY_PAGE_LIMIT");
    } finally { await flushTokens(); }
  }

  async createBookingEvent(booking: CalendarBooking) {
    const { calendar, calendarId, flushTokens } = await this.client(booking.hostId, booking.workspaceId); const eventId = providerCalendarEventId(booking.id);
    try { const response = await calendar.events.insert(googleCreateEventRequest(calendarId, eventId, booking), { timeout: CALENDAR_PROVIDER_TIMEOUT_MS });
    return { eventId: response.data.id || eventId, etag: response.data.etag, disposition: "created" as const };
    } catch (error) {
      if (isProviderConflict(error)) return { eventId, disposition: "conflict" as const };
      throw error;
    } finally { await flushTokens(); }
  }

  async updateBookingEvent(booking: CalendarBooking) {
    const eventId = booking.externalCalendarEventId || providerCalendarEventId(booking.id);
    const { calendar, calendarId, flushTokens } = await this.client(booking.hostId, booking.workspaceId);
    try {
      return await reconcileGoogleEventUpdate(
        eventId,
        async () => (await calendar.events.get({ calendarId, eventId }, { timeout: CALENDAR_PROVIDER_TIMEOUT_MS })).data.etag,
        async () => {
          const creation = await this.createBookingEvent(booking);
          if (!creation) throw new Error("GOOGLE_EVENT_CREATE_REQUIRED");
          return typeof creation === "string" ? { disposition: "conflict" as const } : creation;
        },
        async (etag) => (await calendar.events.patch(googleUpdateEventRequest(calendarId, eventId, booking), googleConditionalRequestOptions(etag))).data.etag,
      );
    } finally { await flushTokens(); }
  }

  async deleteBookingEvent(booking: CalendarBooking) {
    const eventId = booking.externalCalendarEventId || providerCalendarEventId(booking.id);
    const { calendar, calendarId, flushTokens } = await this.client(booking.hostId, booking.workspaceId);
    try {
      let current;
      try { current = await calendar.events.get({ calendarId, eventId }, { timeout: CALENDAR_PROVIDER_TIMEOUT_MS }); }
      catch (error) { if (isProviderNotFound(error)) return { eventId, providerAbsent: true }; throw error; }
      if (!current.data.etag) throw new Error("GOOGLE_EVENT_ETAG_REQUIRED");
      await calendar.events.delete(googleDeleteEventRequest(calendarId, eventId), googleConditionalRequestOptions(current.data.etag));
      return { eventId, providerAbsent: false };
    } finally { await flushTokens(); }
  }

  async providerKind() { return "google" as const; }
  async candidateEventId(booking: CalendarBooking) { return providerCalendarEventId(booking.id); }
}

export function providerCalendarEventId(bookingId: string) { return `tc${createHash("sha256").update(bookingId).digest("hex").slice(0, 40)}`; }
export function googleCreateEventRequest(calendarId: string, eventId: string, booking: CalendarBooking) {
  const locationType = booking.locationTypeSnapshot || booking.eventType.locationType;
  const title = booking.eventTitleSnapshot || booking.eventType.name;
  return {
    calendarId, conferenceDataVersion: locationType === "GOOGLE_MEET" ? 1 : 0, sendUpdates: "all" as const,
    requestBody: {
      id: eventId, summary: `${title} with ${booking.inviteeName}`, description: booking.notes || undefined,
      location: booking.locationValueSnapshot || undefined,
      start: { dateTime: booking.startAt.toISOString(), timeZone: booking.host.timeZone }, end: { dateTime: booking.endAt.toISOString(), timeZone: booking.host.timeZone },
      attendees: [{ email: booking.inviteeEmail, displayName: booking.inviteeName }],
      extendedProperties: { private: { tempoCoveBookingId: booking.id } },
      conferenceData: locationType === "GOOGLE_MEET" ? { createRequest: { requestId: booking.id } } : undefined,
    },
  };
}
export function googleUpdateEventRequest(calendarId: string, eventId: string, booking: CalendarBooking) {
  return { calendarId, eventId, sendUpdates: "all" as const, requestBody: {
    start: { dateTime: booking.startAt.toISOString(), timeZone: booking.host.timeZone }, end: { dateTime: booking.endAt.toISOString(), timeZone: booking.host.timeZone },
    attendees: [{ email: booking.inviteeEmail, displayName: booking.inviteeName }],
  } };
}
export function googleDeleteEventRequest(calendarId: string, eventId: string) { return { calendarId, eventId, sendUpdates: "all" as const }; }
export function googleConditionalRequestOptions(etag: string) { return { timeout: CALENDAR_PROVIDER_TIMEOUT_MS, headers: { "If-Match": etag } }; }
export async function reconcileGoogleEventUpdate(
  eventId: string,
  getEtag: () => Promise<string | null | undefined>,
  createDeterministic: () => Promise<{ disposition: "created" | "conflict"; etag?: string | null }>,
  conditionalPatch: (etag: string) => Promise<string | null | undefined>,
): Promise<CalendarMutationResult> {
  let etag: string | null | undefined;
  try { etag = await getEtag(); }
  catch (error) {
    if (!isProviderNotFound(error)) throw error;
    const creation = await createDeterministic();
    if (creation.disposition === "created") return { eventId, etag: creation.etag };
    etag = await getEtag();
  }
  if (!etag) throw new Error("GOOGLE_EVENT_ETAG_REQUIRED");
  return { eventId, etag: await conditionalPatch(etag) };
}
export function googleEventsListRequest(calendarId: string, timeMin: Date, timeMax: Date, pageToken?: string) {
  return { calendarId, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true, showDeleted: false, maxResults: 2500, pageToken };
}
type GoogleBusyEvent = { id?: string | null; status?: string | null; transparency?: string | null; start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null; end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null };
export function googleEventBusyIntervals(events: GoogleBusyEvent[], excludedEventId: string, calendarTimeZone = "UTC"): BusyInterval[] {
  return events.flatMap((event) => {
    if (!event.id || event.id === excludedEventId || event.status === "cancelled" || event.transparency === "transparent") return [];
    const startText = event.start?.dateTime || event.start?.date; const endText = event.end?.dateTime || event.end?.date; if (!startText || !endText) return [];
    const start = event.start?.dateTime ? new Date(startText) : DateTime.fromISO(startText, { zone: event.start?.timeZone || calendarTimeZone }).toUTC().toJSDate();
    const end = event.end?.dateTime ? new Date(endText) : DateTime.fromISO(endText, { zone: event.end?.timeZone || event.start?.timeZone || calendarTimeZone }).toUTC().toJSDate();
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start ? [{ start, end }] : [];
  });
}
function isProviderConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 409; }
export function isProviderNotFound(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 404; }

async function credentialWorkspace(userId: string, workspaceId?: string) {
  if (!workspaceId) throw new AppError("WORKSPACE_CONTEXT_REQUIRED", "A workspace-bound calendar operation is required.", 400);
  return runWithWorkspaceRead(userId, workspaceId, async () => {
    if (!await liveWorkspaceMember(userId, workspaceId)) throw new AppError("FORBIDDEN", "You no longer have access to this workspace calendar.", 403);
    return workspaceId;
  });
}

async function googleCredentialsReadyWithin(userId: string, resolvedWorkspaceId: string) {
  const connection = await db.oAuthConnection.findUnique({ where: { workspaceId_provider: { workspaceId: resolvedWorkspaceId, provider: "google" } }, select: { userId: true, refreshToken: true, disconnectStatus: true } });
  if (connection && !await liveWorkspaceMember(connection.userId, resolvedWorkspaceId, "ADMIN")) return false;
  if (connection?.disconnectStatus !== undefined && connection.disconnectStatus !== "ACTIVE") return false;
  if (connection?.refreshToken) return Boolean(process.env.TOKEN_ENCRYPTION_KEY);
  return environmentGoogleCredentialAllowed(resolvedWorkspaceId);
}
export async function googleCredentialsReady(userId: string, workspaceId?: string) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return false;
  const projected = await publicGoogleReady();
  if (projected !== null) return projected && Boolean(process.env.TOKEN_ENCRYPTION_KEY);
  const resolvedWorkspaceId = await credentialWorkspace(userId, workspaceId);
  return runWithWorkspaceRead(userId, resolvedWorkspaceId, () => googleCredentialsReadyWithin(userId, resolvedWorkspaceId));
}

export function clearGoogleScopeHealthCache(workspaceId?: string) { if (workspaceId) googleScopeHealthCache.delete(workspaceId); else googleScopeHealthCache.clear(); }
export async function getGoogleScopeHealth(userId: string, scopeProbe?: () => Promise<GoogleScopeHealth>, now = Date.now(), workspaceId?: string): Promise<GoogleScopeHealth> {
  if (publicGoogleEventId()) {
    if (!workspaceId) throw new AppError("WORKSPACE_CONTEXT_REQUIRED", "A workspace-bound calendar operation is required.", 400);
    return getGoogleScopeHealthWithin(userId, workspaceId, scopeProbe, now);
  }
  const resolvedWorkspaceId = await credentialWorkspace(userId, workspaceId);
  return runWithWorkspaceRead(userId, resolvedWorkspaceId, () => getGoogleScopeHealthWithin(userId, resolvedWorkspaceId, scopeProbe, now));
}
async function getGoogleScopeHealthWithin(userId: string, resolvedWorkspaceId: string, scopeProbe: (() => Promise<GoogleScopeHealth>) | undefined, now: number): Promise<GoogleScopeHealth> {
  if (!await googleCredentialsReady(userId, resolvedWorkspaceId)) {
    console.error("Google credentials not ready", { hasContext: Boolean(currentDatabaseContext()) });
    googleScopeHealthCache.delete(resolvedWorkspaceId); return { scopeHealth: "unavailable", missingScopes: [...REQUIRED_GOOGLE_CALENDAR_SCOPES] };
  }
  if (providerProofMode()) return { scopeHealth: "complete", missingScopes: [] };
  const cached = googleScopeHealthCache.get(resolvedWorkspaceId); if (cached && cached.expiresAt > now) return cached.value;
  let value: GoogleScopeHealth;
  try { value = scopeProbe ? await scopeProbe() : await new GoogleCalendarService().scopeHealth(userId, resolvedWorkspaceId); }
  catch (error) {
    const raw = error instanceof Error ? error.message : "unknown";
    const code = raw.length <= 80 && !/eyJ|ya29\.|1\/|aesgcm/.test(raw) ? raw : error instanceof Error ? error.name : "unknown";
    console.error("Google scope health unavailable", { code });
    value = { scopeHealth: "unavailable", missingScopes: [] };
  }
  googleScopeHealthCache.set(resolvedWorkspaceId, { value, expiresAt: now + GOOGLE_SCOPE_HEALTH_TTL_MS }); return value;
}

export async function googleCalendarReady(userId: string, workspaceId?: string) {
  return process.env.CALENDAR_PROVIDER === "google" && (await getGoogleScopeHealth(userId, undefined, Date.now(), workspaceId)).scopeHealth === "complete";
}

class FallbackCalendarService implements CalendarService {
  private readonly google = new GoogleCalendarService();
  private readonly proofGoogle = new ProofGoogleCalendarService();
  private readonly local = new LocalCalendarService();
  private async service(userId: string, workspaceId?: string) {
    if (process.env.CALENDAR_PROVIDER === "local" && process.env.NODE_ENV !== "production") return this.local;
    if (process.env.CALENDAR_PROVIDER !== "google" || !await googleCalendarReady(userId, workspaceId)) throw new AppError("GOOGLE_CALENDAR_RETRY", "This workspace requires a live Google Calendar connection before availability can be trusted.", 503);
    return providerProofMode() ? this.proofGoogle : this.google;
  }
  async getBusyIntervals(userId: string, timeMin: Date, timeMax: Date, workspaceId?: string) { return (await this.service(userId, workspaceId)).getBusyIntervals(userId, timeMin, timeMax, workspaceId); }
  async getBusyIntervalsExcludingEvent(userId: string, timeMin: Date, timeMax: Date, excludedEventId: string, requiredProvider?: "google" | "local", workspaceId?: string) {
    let service: CalendarService;
    if (requiredProvider === "google") {
      if (!await googleCredentialsReady(userId, workspaceId)) throw new AppError("GOOGLE_CALENDAR_RETRY", "This accepted Google booking requires its configured provider for conflict checks.", 503);
      service = providerProofMode() ? this.proofGoogle : this.google;
    } else if (requiredProvider === "local") service = this.local;
    else service = await this.service(userId, workspaceId);
    return service.getBusyIntervalsExcludingEvent?.(userId, timeMin, timeMax, excludedEventId, requiredProvider, workspaceId) ?? service.getBusyIntervals(userId, timeMin, timeMax, workspaceId);
  }
  private async bookingService(booking: CalendarBooking) {
    if (booking.calendarProviderSnapshot === "provider_recovery_required") throw new AppError("CALENDAR_PROVIDER_RECOVERY_REQUIRED", "This upgraded booking requires provider-lineage reconciliation before calendar mutation.", 503);
    if (booking.calendarProviderSnapshot !== "google") return this.local;
    if (!await googleCredentialsReady(booking.hostId, booking.workspaceId)) throw new AppError("GOOGLE_CALENDAR_RETRY", "The accepted Google Calendar booking is waiting for its configured provider credentials.", 503);
    return providerProofMode() ? this.proofGoogle : this.google;
  }
  async createBookingEvent(booking: CalendarBooking) { return (await this.bookingService(booking)).createBookingEvent(booking); }
  async updateBookingEvent(booking: CalendarBooking) { return (await this.bookingService(booking)).updateBookingEvent(booking); }
  async deleteBookingEvent(booking: CalendarBooking) {
    if (booking.calendarProviderSnapshot === "provider_recovery_required") {
      if (!await googleCredentialsReady(booking.hostId, booking.workspaceId)) throw new AppError("GOOGLE_CALENDAR_RETRY", "This recovery delete is waiting for its configured Google credentials.", 503);
      return (providerProofMode() ? this.proofGoogle : this.google).deleteBookingEvent({ ...booking, externalCalendarEventId: providerCalendarEventId(booking.id) });
    }
    return (await this.bookingService(booking)).deleteBookingEvent(booking);
  }
  async providerKind(userId: string, workspaceId?: string) { const service: CalendarService = await this.service(userId, workspaceId); return await service.providerKind?.(userId, workspaceId) ?? "google" as const; }
  async candidateEventId(booking: CalendarBooking) { return booking.calendarProviderSnapshot === "google" || booking.calendarProviderSnapshot === "provider_recovery_required" ? providerCalendarEventId(booking.id) : null; }
}

export function getCalendarService(): CalendarService {
  return new FallbackCalendarService();
}

export async function googleCalendarStatus(
  userId: string,
  workspaceIdOrLoader?: string | ((userId: string) => Promise<GoogleScopeHealth>),
  suppliedScopeHealthLoader?: (userId: string) => Promise<GoogleScopeHealth>,
) {
  const workspaceId = typeof workspaceIdOrLoader === "string" ? workspaceIdOrLoader : undefined;
  const scopeHealthLoader = typeof workspaceIdOrLoader === "function" ? workspaceIdOrLoader : suppliedScopeHealthLoader;
  const resolvedWorkspaceId = await credentialWorkspace(userId, workspaceId);
  return runWithWorkspaceRead(userId, resolvedWorkspaceId, async () => {
    const connection = await db.oAuthConnection.findUnique({ where: { workspaceId_provider: { workspaceId: resolvedWorkspaceId, provider: "google" } } });
    const credentialsReady = await googleCredentialsReady(userId, resolvedWorkspaceId);
    if (!credentialsReady) console.error("Google credentials not ready", { hasContext: Boolean(currentDatabaseContext()), hasConnection: Boolean(connection?.refreshToken) });
    const scope = credentialsReady ? await (scopeHealthLoader ? scopeHealthLoader(userId) : getGoogleScopeHealth(userId, undefined, Date.now(), resolvedWorkspaceId)) : { scopeHealth: "unavailable" as const, missingScopes: [...REQUIRED_GOOGLE_CALENDAR_SCOPES] };
    const ready = process.env.CALENDAR_PROVIDER === "google" && credentialsReady && scope.scopeHealth === "complete";
    return {
      configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      connected: ready,
      credentialSource: connection?.refreshToken ? "encrypted_database" as const : environmentGoogleCredentialAllowed(resolvedWorkspaceId) ? "environment" as const : "none" as const,
      disconnectSupported: Boolean(connection?.refreshToken),
      disconnectPending: Boolean(connection && connection.disconnectStatus !== "ACTIVE"),
      provider: ready ? "google" : "local",
      requestedProvider: process.env.CALENDAR_PROVIDER === "google" ? "google" as const : "local" as const,
      calendarId: connection?.calendarId || process.env.GOOGLE_CALENDAR_ID || "primary",
      ...scope,
    };
  });
}

type VerifiedGoogleAuthorization = { accessToken?: string | null; refreshToken?: string | null; expiresAt?: Date | null; providerUserId: string; scope: string };
async function persistVerifiedGoogleAuthorizationWithinTransaction(tx: Prisma.TransactionClient, userId: string, expectedConnectionId: string | null, expectedConnectionGeneration: number | null, tokens: VerifiedGoogleAuthorization, resolvedWorkspaceId: string) {
  const administrator = await tx.membership.findFirst({ where: { workspaceId: resolvedWorkspaceId, userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } });
  if (!administrator) throw new AppError("FORBIDDEN", "Administrator access is required to connect Google Calendar.", 403);
  if (expectedConnectionId) {
    if (expectedConnectionGeneration == null) throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "The Google credential generation was not bound. Start again.", 409);
    const predecessor = await tx.oAuthConnection.findFirst({ where: { id: expectedConnectionId, workspaceId: resolvedWorkspaceId, provider: "google", disconnectStatus: "ACTIVE", credentialGeneration: expectedConnectionGeneration } });
    if (!predecessor) throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "The Google credential changed while authorization was completing. Start again.", 409);
    if (predecessor.providerUserId !== tokens.providerUserId) throw new AppError("GOOGLE_SUBJECT_REPLACEMENT_REQUIRES_DISCONNECT", "Disconnect the current Google account successfully before connecting a different Google account.", 409);
    if (!tokens.refreshToken && !predecessor.refreshToken) throw new AppError("GOOGLE_REFRESH_REQUIRED", "Google did not return durable offline access. Reconnect and approve consent.", 400);
    const saved = await tx.oAuthConnection.updateMany({ where: { id: predecessor.id, workspaceId: resolvedWorkspaceId, userId: predecessor.userId, provider: "google", providerUserId: tokens.providerUserId, disconnectStatus: "ACTIVE", credentialGeneration: expectedConnectionGeneration }, data: { userId, accessToken: encryptToken(tokens.accessToken), refreshToken: predecessor.refreshToken ? undefined : tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined, expiresAt: tokens.expiresAt, scope: tokens.scope, credentialGeneration: { increment: 1 } } });
    if (saved.count !== 1) throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "The Google credential changed while authorization was completing. Start again.", 409);
    return;
  }
  if (!tokens.refreshToken) throw new AppError("GOOGLE_REFRESH_REQUIRED", "Google did not return durable offline access. Reconnect and approve consent.", 400);
  const existing = await tx.oAuthConnection.count({ where: { workspaceId: resolvedWorkspaceId, provider: "google" } });
  if (existing !== 0) throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "A Google credential appeared while authorization was completing. Start again.", 409);
  try { await tx.oAuthConnection.create({ data: { workspaceId: resolvedWorkspaceId, userId, provider: "google", providerUserId: tokens.providerUserId, accessToken: encryptToken(tokens.accessToken), refreshToken: encryptToken(tokens.refreshToken), expiresAt: tokens.expiresAt, scope: tokens.scope, calendarId: process.env.GOOGLE_CALENDAR_ID || "primary", disconnectStatus: "ACTIVE", credentialGeneration: 1 } }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "A Google credential appeared while authorization was completing. Start again.", 409); throw error; }
}

export async function persistVerifiedGoogleAuthorization(userId: string, expectedConnectionId: string | null, expectedConnectionGeneration: number | null, tokens: VerifiedGoogleAuthorization, workspaceId?: string) {
  assertRequiredGoogleScopes(tokens.scope);
  const resolvedWorkspaceId = await credentialWorkspace(userId, workspaceId);
  enterDatabaseAction("oauth_write", { workspaceId: resolvedWorkspaceId, userId, subject: "ADMIN" });
  await db.$transaction(async (tx) => { await persistVerifiedGoogleAuthorizationWithinTransaction(tx, userId, expectedConnectionId, expectedConnectionGeneration, tokens, resolvedWorkspaceId); });
  clearGoogleScopeHealthCache(resolvedWorkspaceId);
}

export async function disconnectGoogleCalendar(userId: string, revoke: (token: string) => Promise<void> = async (token) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth client is not configured.");
  await new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET).revokeToken(token);
}, now = new Date(), workspaceId?: string) {
  const resolvedWorkspaceId = await credentialWorkspace(userId, workspaceId);
  enterDatabaseAction("oauth_write", { workspaceId: resolvedWorkspaceId, userId, subject: "ADMIN" });
  if (!await liveWorkspaceMember(userId, resolvedWorkspaceId, "ADMIN")) throw new AppError("FORBIDDEN", "Administrator access is required to disconnect Google Calendar.", 403);
  const claimed = await db.$transaction(async (tx) => {
    const administrator = await tx.membership.findFirst({ where: { workspaceId: resolvedWorkspaceId, userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } });
    if (!administrator) throw new AppError("FORBIDDEN", "Administrator access is required to disconnect Google Calendar.", 403);
    const current = await tx.oAuthConnection.findUnique({ where: { workspaceId_provider: { workspaceId: resolvedWorkspaceId, provider: "google" } } });
    if (!current) return null;
    const claimableStatuses = [
      ...(current.disconnectStatus === "ACTIVE" ? [{ disconnectStatus: "ACTIVE" as const }] : []),
      ...(current.disconnectStatus === "REVOKE_RETRY" && current.disconnectRetryAt && current.disconnectRetryAt <= now ? [{ disconnectStatus: "REVOKE_RETRY" as const, disconnectRetryAt: { lte: now } }] : []),
      ...(current.disconnectStatus === "REVOKE_IN_PROGRESS" && current.disconnectLeaseExpiresAt && current.disconnectLeaseExpiresAt <= now ? [{ disconnectStatus: "REVOKE_IN_PROGRESS" as const, disconnectLeaseExpiresAt: { lte: now } }] : []),
    ];
    if (!claimableStatuses.length) throw new AppError("GOOGLE_REVOKE_PENDING", "Google credential revocation is already pending or in progress.", 409);
    const leaseToken = randomBytes(18).toString("base64url");
    const leaseExpiresAt = new Date(now.getTime() + GOOGLE_REVOKE_LEASE_MS);
    const won = await tx.oAuthConnection.updateMany({ where: { id: current.id, workspaceId: resolvedWorkspaceId, userId: current.userId, provider: "google", OR: claimableStatuses }, data: { disconnectStatus: "REVOKE_IN_PROGRESS", disconnectRetryAt: null, disconnectErrorCode: null, disconnectLeaseToken: leaseToken, disconnectLeaseExpiresAt: leaseExpiresAt } });
    if (won.count !== 1) throw new AppError("GOOGLE_REVOKE_PENDING", "Google credential revocation is already pending or in progress.", 409);
    const fenced = await tx.oAuthConnection.findFirstOrThrow({ where: { id: current.id, workspaceId: resolvedWorkspaceId, userId: current.userId, provider: "google", disconnectStatus: "REVOKE_IN_PROGRESS", disconnectLeaseToken: leaseToken, disconnectLeaseExpiresAt: { gt: now } } });
    return { id: fenced.id, credentialUserId: fenced.userId, token: decryptToken(fenced.refreshToken) || decryptToken(fenced.accessToken), leaseToken };
  });
  if (!claimed) {
    if (environmentGoogleCredentialAllowed(resolvedWorkspaceId)) throw new AppError("ENV_CREDENTIAL_MANAGED_EXTERNALLY", "The environment-provided Google credential must be revoked outside SnagTime.", 409);
    return { disconnected: true as const };
  }
  clearGoogleScopeHealthCache(resolvedWorkspaceId);
  try {
    if (!claimed.token) throw new Error("GOOGLE_REVOKE_TOKEN_MISSING");
    await revoke(claimed.token);
    const removed = await db.oAuthConnection.deleteMany({ where: { id: claimed.id, workspaceId: resolvedWorkspaceId, userId: claimed.credentialUserId, provider: "google", disconnectStatus: "REVOKE_IN_PROGRESS", disconnectLeaseToken: claimed.leaseToken } });
    if (removed.count !== 1) throw new AppError("GOOGLE_REVOKE_FENCE_LOST", "Google credential revocation was reclaimed by another worker. Refresh and retry.", 409);
    clearGoogleScopeHealthCache(resolvedWorkspaceId); return { disconnected: true as const };
  } catch {
    const retried = await db.oAuthConnection.updateMany({ where: { id: claimed.id, workspaceId: resolvedWorkspaceId, userId: claimed.credentialUserId, provider: "google", disconnectStatus: "REVOKE_IN_PROGRESS", disconnectLeaseToken: claimed.leaseToken }, data: { disconnectStatus: "REVOKE_RETRY", disconnectRetryAt: new Date(now.getTime() + 5 * 60_000), disconnectErrorCode: "GOOGLE_REVOKE_FAILED", disconnectLeaseToken: null, disconnectLeaseExpiresAt: null } });
    if (retried.count !== 1) throw new AppError("GOOGLE_REVOKE_FENCE_LOST", "Google credential revocation was reclaimed by another worker. Refresh and retry.", 409);
    clearGoogleScopeHealthCache(resolvedWorkspaceId);
    throw new AppError("GOOGLE_REVOKE_PENDING", "Google access could not be revoked yet. The encrypted credential was retained for a safe retry.", 503);
  }
}

export async function retryPendingGoogleDisconnects(now = new Date(), revoke?: (token: string) => Promise<void>, signal?: AbortSignal) {
  const due = await db.oAuthConnection.findMany({ where: { provider: "google", OR: [{ disconnectStatus: "REVOKE_RETRY", disconnectRetryAt: { lte: now } }, { disconnectStatus: "REVOKE_IN_PROGRESS", disconnectLeaseExpiresAt: { lte: now } }] }, select: { userId: true, workspaceId: true }, take: 20 });
  let completed = 0;
  for (const item of due) {
    if (signal?.aborted) break;
    try { await disconnectGoogleCalendar(item.userId, revoke, now, item.workspaceId); completed += 1; } catch { /* disconnectGoogleCalendar retains ciphertext and schedules the next bounded retry. */ }
  }
  return { attempted: signal?.aborted ? completed : due.length, completed };
}

export async function createGoogleAuthorization(userId: string, authSessionId: string, workspaceId?: string) {
  enterDatabaseAction("oauth_write", { workspaceId, userId, subject: "ADMIN" });
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const nonce = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    const session = await tx.authSession.findFirst({ where: { id: authSessionId, userId, revokedAt: null, expiresAt: { gt: new Date() }, membership: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } } } });
    if (!session) throw new AppError("FORBIDDEN", "Administrator access is required to connect Google Calendar.", 403);
    const resolvedWorkspaceId = workspaceId ?? session.activeWorkspaceId;
    if (session.activeWorkspaceId !== resolvedWorkspaceId) throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "The active workspace changed. Start again.", 409);
    const connection = await tx.oAuthConnection.findUnique({ where: { workspaceId_provider: { workspaceId: resolvedWorkspaceId, provider: "google" } }, select: { id: true, disconnectStatus: true, credentialGeneration: true } });
    if (connection && connection.disconnectStatus !== "ACTIVE") throw new AppError("GOOGLE_REVOKE_PENDING", "Finish revoking the retained Google credential before reconnecting.", 409);
    await tx.oAuthState.create({ data: { id: state, workspaceId: resolvedWorkspaceId, userId, authSessionId, expectedConnectionId: connection?.id, expectedConnectionGeneration: connection?.credentialGeneration, codeVerifier: encryptToken(codeVerifier)!, nonce: encryptToken(nonce)!, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  });
  return new GoogleCalendarService().authorizationUrl(state, codeChallenge, nonce);
}

export async function consumeGoogleAuthorization(userId: string, authSessionId: string, state: string, code: string, finalizeHooks?: { beforeFinalize?: () => Promise<void>; afterPersist?: () => Promise<void> }, workspaceId?: string) {
  enterDatabaseAction("oauth_write", { workspaceId, userId, subject: "ADMIN" });
  const now = new Date(); const processingToken = randomBytes(18).toString("base64url");
  const activeSession = await db.authSession.findFirst({ where: { id: authSessionId, userId, revokedAt: null, membership: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } } } });
  if (!activeSession) throw new AppError("INVALID_OAUTH_CALLBACK", "Sign in again, then reconnect Google Calendar from Integrations.", 401);
  enterDatabaseAction("oauth_write", { workspaceId: workspaceId || activeSession.activeWorkspaceId, userId, subject: "ADMIN" });
  const record = await db.oAuthState.findFirst({ where: { id: state, workspaceId: activeSession.activeWorkspaceId, userId, authSessionId, consumedAt: null, expiresAt: { gt: now }, OR: [{ processingToken: null }, { processingExpiresAt: { lte: now } }] } });
  if (!record) throw new AppError("INVALID_OAUTH_CALLBACK", "This Google authorization is invalid or already used. Start again from Integrations.", 400);
  const claimed = await db.oAuthState.updateMany({ where: { id: state, workspaceId: record.workspaceId, userId, authSessionId, consumedAt: null, OR: [{ processingToken: null }, { processingExpiresAt: { lte: now } }] }, data: { processingToken, processingExpiresAt: new Date(now.getTime() + 60_000) } });
  if (claimed.count !== 1) throw new AppError("INVALID_OAUTH_CALLBACK", "This Google authorization is already being processed. Start again from Integrations.", 409);
  const heartbeat = setInterval(() => { void db.oAuthState.updateMany({ where: { id: state, workspaceId: record.workspaceId, authSessionId, processingToken, consumedAt: null, expiresAt: { gt: new Date() } }, data: { processingExpiresAt: new Date(Date.now() + 60_000) } }).catch(() => undefined); }, 20_000);
  heartbeat.unref();
  try {
    const verified = await new GoogleCalendarService().exchangeAuthorizationCode(userId, code, decryptToken(record.codeVerifier)!, decryptToken(record.nonce)!);
    if (finalizeHooks?.beforeFinalize) await finalizeHooks.beforeFinalize();
    await db.$transaction(async (tx) => {
      const liveSession = await tx.authSession.findFirst({ where: { id: authSessionId, userId, activeWorkspaceId: record.workspaceId, revokedAt: null, expiresAt: { gt: new Date() }, membership: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, workspaceId: record.workspaceId, userId } } });
      if (!liveSession) throw new AppError("GOOGLE_CREDENTIAL_FENCE_LOST", "The active workspace changed. Start again.", 409);
      const liveState = await tx.oAuthState.findFirst({ where: { id: state, workspaceId: record.workspaceId, userId, authSessionId, processingToken, consumedAt: null, expiresAt: { gt: new Date() }, processingExpiresAt: { gt: new Date() } } });
      if (!liveState) throw new AppError("INVALID_OAUTH_CALLBACK", "This Google authorization is already being processed. Start again from Integrations.", 409);
      await persistVerifiedGoogleAuthorizationWithinTransaction(tx, userId, record.expectedConnectionId, record.expectedConnectionGeneration, verified, record.workspaceId);
      if (finalizeHooks?.afterPersist) await finalizeHooks.afterPersist();
      const consumed = await tx.oAuthState.updateMany({ where: { id: state, workspaceId: record.workspaceId, authSessionId, processingToken, consumedAt: null, processingExpiresAt: { gt: new Date() } }, data: { consumedAt: new Date(), codeVerifier: "", nonce: "", processingToken: null, processingExpiresAt: null } });
      if (consumed.count !== 1) throw new AppError("INVALID_OAUTH_CALLBACK", "Google authorization changed during completion. Start again from Integrations.", 409);
    });
    clearGoogleScopeHealthCache(record.workspaceId);
  } catch (error) {
    await db.oAuthState.updateMany({ where: { id: state, workspaceId: record.workspaceId, authSessionId, processingToken, consumedAt: null }, data: { processingToken: null, processingExpiresAt: null } });
    throw error;
  } finally { clearInterval(heartbeat); }
}
