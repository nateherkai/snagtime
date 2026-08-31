import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Membership, User, Workspace } from "@prisma/client";
import { db } from "@/server/db";
import { AppError, unauthorized } from "@/server/errors";
import { enterDatabaseContext } from "@/server/db-context";
import { systemEmailIdentity } from "@/server/email-config";

export const SESSION_COOKIE = "tempocove_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = { userId: string; expiresAt: number; nonce: string };

function sessionSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret && Buffer.byteLength(secret) >= 32) return secret;
  if (process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production") return "tempocove-explicit-demo-secret-not-for-production";
  throw new Error("AUTH_SECRET with at least 32 bytes is required outside explicit demo mode.");
}

function encode(value: string) { return Buffer.from(value).toString("base64url"); }
function signature(payload: string) { return createHmac("sha256", sessionSecret()).update(payload).digest("base64url"); }

export function createSessionToken(userId: string, now = Date.now()) {
  const payload = encode(JSON.stringify({ userId, expiresAt: now + SESSION_SECONDS * 1000, nonce: randomBytes(18).toString("base64url") } satisfies SessionPayload));
  return `${payload}.${signature(payload)}`;
}

export function readSessionToken(token: string | undefined, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed.userId || !parsed.nonce || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
    return parsed;
  } catch { return null; }
}

export function sessionTokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";
const roleRank: Record<WorkspaceRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export async function createSessionForUser(userId: string, membershipId?: string, revokeExisting = true) {
  const membership = membershipId
    ? await db.membership.findFirst({ where: { id: membershipId, userId, status: "ACTIVE" } })
    : (await db.membership.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }))
      .sort((left, right) => roleRank[right.role as WorkspaceRole] - roleRank[left.role as WorkspaceRole])[0];
  if (!membership) throw unauthorized();
  enterDatabaseContext({ mode: "auth", userId, workspaceId: membership.workspaceId, subject: userId });
  const token = createSessionToken(userId);
  const payload = readSessionToken(token)!;
  await db.$transaction(async (tx) => {
    if (revokeExisting) await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.authSession.create({ data: { userId, activeWorkspaceId: membership.workspaceId, membershipId: membership.id, tokenHash: sessionTokenHash(token), expiresAt: new Date(payload.expiresAt) } });
  });
  return token;
}

function requestCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

export async function getSessionUser(request: Request): Promise<User | null> {
  return (await getSessionRecord(request))?.user || null;
}

export async function getSessionRecord(request: Request) {
  const token = requestCookie(request, SESSION_COOKIE);
  const session = readSessionToken(token);
  if (!session || !token) return null;
  const tokenHash = sessionTokenHash(token); enterDatabaseContext({ mode: "session", userId: session.userId, sessionHash: tokenHash, subject: session.userId });
  const record = await db.authSession.findFirst({
    where: { tokenHash, userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() }, membership: { status: "ACTIVE", userId: session.userId } },
    include: { user: true, membership: true, workspace: true },
  });
  if (record) enterDatabaseContext({ mode: "workspace", workspaceId: record.activeWorkspaceId, userId: record.userId, sessionHash: tokenHash, subject: record.membership.role,action:"workspace_read" });
  return record || null;
}

export async function requireSessionUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw unauthorized();
  return user;
}

export async function requireSessionRecord(request: Request) {
  const session = await getSessionRecord(request);
  if (!session) throw unauthorized();
  return session;
}

export type WorkspaceAccess = {
  sessionId: string;
  user: User;
  membership: Membership;
  workspace: Workspace;
  workspaceId: string;
  role: WorkspaceRole;
};

export async function requireWorkspaceAccess(request: Request, minimumRole: WorkspaceRole = "MEMBER"): Promise<WorkspaceAccess> {
  const session = await requireSessionRecord(request);
  const role = session.membership.role as WorkspaceRole;
  if (!(role in roleRank) || roleRank[role] < roleRank[minimumRole]) throw new AppError("FORBIDDEN", "You do not have access to this workspace action.", 403);
  return { sessionId: session.id, user: session.user, membership: session.membership, workspace: session.workspace, workspaceId: session.activeWorkspaceId, role };
}

export async function requireWorkspaceMutationAccess(request: Request, minimumRole: WorkspaceRole = "MEMBER") {
  assertSameOrigin(request);
  return requireWorkspaceAccess(request, minimumRole);
}

export async function rotateSessionWorkspace(request: Request, workspaceId: string) {
  assertSameOrigin(request);
  const current = await requireSessionRecord(request);
  const membership = await db.membership.findFirst({ where: { workspaceId, userId: current.userId, status: "ACTIVE" } });
  if (!membership) throw new AppError("FORBIDDEN", "You do not have access to that workspace.", 403);
  const token = createSessionToken(current.userId); const payload = readSessionToken(token)!; const now = new Date();
  await db.$transaction(async (tx) => {
    const revoked = await tx.authSession.updateMany({ where: { id: current.id, revokedAt: null }, data: { revokedAt: now } });
    if (revoked.count !== 1) throw unauthorized();
    await tx.authSession.create({ data: { userId: current.userId, activeWorkspaceId: workspaceId, membershipId: membership.id, tokenHash: sessionTokenHash(token), expiresAt: new Date(payload.expiresAt) } });
  });
  return token;
}

export async function revokeRequestSession(request: Request) {
  const token = requestCookie(request, SESSION_COOKIE);
  const payload = readSessionToken(token);
  if (token && payload) { const tokenHash=sessionTokenHash(token); enterDatabaseContext({mode:"session",userId:payload.userId,sessionHash:tokenHash,subject:payload.userId}); await db.authSession.updateMany({ where: { tokenHash, userId:payload.userId, revokedAt: null }, data: { revokedAt: new Date() } }); }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  assertProductionRuntimeSecurity();
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const expected = new URL(configured || "http://localhost:3000").origin;
  if (!origin || origin !== expected) throw unauthorized();
}

export function assertProductionRuntimeSecurity() {
  if (process.env.GOOGLE_REFRESH_TOKEN && (process.env.NODE_ENV === "production" || process.env.DEMO_MODE !== "true" || !process.env.GOOGLE_ENV_WORKSPACE_ID)) {
    throw new Error("An environment Google refresh token is local-demo-only and must be bound to GOOGLE_ENV_WORKSPACE_ID.");
  }
  if (process.env.EMAIL_PROVIDER === "local" && (process.env.NODE_ENV === "production" || process.env.DEMO_MODE !== "true")) throw new Error("The local email provider and inbox require explicit non-production DEMO_MODE=true.");
  if (process.env.NODE_ENV !== "production") return;
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  let canonical: URL;
  try { canonical = new URL(configured || ""); } catch { throw new Error("Production requires a canonical HTTPS NEXT_PUBLIC_APP_URL."); }
  if (canonical.protocol !== "https:" || canonical.username || canonical.password || canonical.pathname !== "/" || canonical.search || canonical.hash) throw new Error("Production requires a canonical HTTPS NEXT_PUBLIC_APP_URL.");
  const databaseRole = process.env.DATABASE_ROLE || "app"; if (databaseRole !== "app" && databaseRole !== "worker") throw new Error("Production DATABASE_ROLE must be app or worker.");
  const runtimeUrl = databaseRole === "worker" ? process.env.WORKER_DATABASE_URL : process.env.DATABASE_URL;
  if (databaseRole === "app") sessionSecret();
  if (process.env.DATABASE_PROVIDER !== "postgresql" || !/^postgres(?:ql)?:\/\//.test(runtimeUrl || "") || !/[?&]sslmode=verify-full(?:&|$)/.test(runtimeUrl || "") || !/[?&]sslrootcert=[^&]+/.test(runtimeUrl || "") || !/[?&]connect_timeout=[1-5](?:&|$)/.test(runtimeUrl || "") || !/[?&]pool_timeout=(?:1[5-9]|2\d|30)(?:&|$)/.test(runtimeUrl || "") || !/[?&]connection_limit=(?:1\d|[2-4]\d|50)(?:&|$)/.test(runtimeUrl || "") || !/[?&]statement_timeout=(?:[5-9]\d{2}|[12]\d{3}|3000)(?:&|$)/.test(runtimeUrl || "")) throw new Error("Production requires the role-specific PostgreSQL URL with verified TLS, explicit CA, bounded connect/pool/statement timeouts, and an explicit concurrency pool; SQLite fallback is forbidden.");
  if (databaseRole === "app" && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(process.env.BOOKING_CAPABILITY_KEY_ID || "") || Buffer.byteLength(process.env.BOOKING_CAPABILITY_SECRET || "") < 32 || process.env.BOOKING_CAPABILITY_SECRET === (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET))) throw new Error("Production requires an independent versioned booking capability signing key.");
  if (databaseRole === "app" && process.env.BOOKING_CAPABILITY_KEYRING) {
    let retained: unknown;
    try { retained = JSON.parse(process.env.BOOKING_CAPABILITY_KEYRING); } catch { throw new Error("Production booking capability keyring is invalid."); }
    const entries = retained && !Array.isArray(retained) && typeof retained === "object" ? Object.entries(retained as Record<string, unknown>) : [];
    if (!retained || Array.isArray(retained) || typeof retained !== "object" || entries.length > 8 || entries.some(([id, secret]) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id) || typeof secret !== "string" || Buffer.byteLength(secret) < 32)) throw new Error("Production booking capability keyring is invalid.");
  }
  if (databaseRole === "app" && (process.env.RATE_LIMIT_PROVIDER !== "postgresql" || Buffer.byteLength(process.env.RATE_LIMIT_HASH_SECRET || "") < 32)) throw new Error("Production requires the PostgreSQL distributed limiter and a distinct hash secret.");
  if (databaseRole === "app" && Buffer.byteLength(process.env.TENANT_CONTEXT_SECRET || "") < 32) throw new Error("Production requires a strong, distinct TENANT_CONTEXT_SECRET.");
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY || ""; if (!/^[0-9A-Fa-f]{64}$/.test(encryptionKey) || new Set(Buffer.from(encryptionKey, "hex")).size < 16) throw new Error("Production requires a diverse 32-byte TOKEN_ENCRYPTION_KEY.");
  if (process.env.OUTBOX_WORKER_MODE !== "dedicated") throw new Error("Production requires a dedicated outbox worker.");
  if (databaseRole === "app" && (process.env.TRUST_PROXY !== "true" || Buffer.byteLength(process.env.PROXY_SHARED_SECRET || "") < 32)) throw new Error("Production requires authenticated trusted-proxy ingress with a strong PROXY_SHARED_SECRET.");
  if (databaseRole === "app" && Buffer.byteLength(process.env.OPERATOR_HEALTH_SECRET || "") < 32) throw new Error("Production requires a strong OPERATOR_HEALTH_SECRET.");
  const standalone = process.env.SNAGTIME_STANDALONE_MODE === "true";
  const councilForgeOnly = process.env.SNAGTIME_COUNCILFORGE_ONLY === "true";
  if (process.env.DEMO_MODE === "true") throw new Error("Production forbids demo mode.");
  if (databaseRole === "app" && councilForgeOnly && Buffer.byteLength(process.env.SNAGTIME_SSO_SECRET || "") < 32) throw new Error("CouncilForge-only production requires a strong SNAGTIME_SSO_SECRET.");
  if (standalone) {
    if (process.env.PAYMENTS_PROVIDER !== "stub" || process.env.CALENDAR_PROVIDER !== "internal" || process.env.EMAIL_PROVIDER !== "disabled") throw new Error("Standalone production requires internal calendar, disabled email, and stub payments.");
  } else {
    if (process.env.PAYMENTS_PROVIDER !== "stripe" || process.env.CALENDAR_PROVIDER !== "google") throw new Error("Integrated production requires Google Calendar and Stripe test mode.");
    if (!process.env.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com") || Buffer.byteLength(process.env.GOOGLE_CLIENT_SECRET || "") < 16) throw new Error("Production Google OAuth configuration is incomplete.");
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || (databaseRole === "app" && !process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))) throw new Error("Production payment provider configuration is incomplete or not test-isolated.");
    if (process.env.EMAIL_PROVIDER !== "smtp" || !["implicit","starttls"].includes(process.env.SMTP_TLS_MODE || "") || ["EMAIL_TOKEN_SECRET","SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASSWORD","EMAIL_FROM","EMAIL_REPLY_TO","EMAIL_SENDER_DOMAIN"].some((name) => !process.env[name])) throw new Error("Production requires complete TLS SMTP, system sender identity, and EMAIL_TOKEN_SECRET configuration.");
    systemEmailIdentity();
  }
  if (Buffer.byteLength(process.env.EMAIL_TOKEN_SECRET || "") < 32) throw new Error("Production requires EMAIL_TOKEN_SECRET with at least 32 bytes.");
}

export async function requireMutationSessionUser(request: Request) {
  assertSameOrigin(request);
  return requireSessionUser(request);
}

export const sessionCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS };
