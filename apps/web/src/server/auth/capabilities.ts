import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import type { BookingManageCapabilities } from "@/lib/contracts";
import { enterCapabilityDatabaseContext } from "@/server/db-context";

export type BookingCapabilityScope = "read" | "cancel" | "reschedule";
const scopes: BookingCapabilityScope[] = ["read", "cancel", "reschedule"];
const MANAGE_COOKIE_PREFIX = "tempocove_booking_manage";
export function manageCookieName(bookingId: string) { return `${MANAGE_COOKIE_PREFIX}_${createHash("sha256").update(bookingId).digest("hex").slice(0, 24)}`; }

const LEGACY_AUTH_KEY_ID = "legacy-auth-v1";
const DEMO_KEY_ID = "demo-capability-v1";
const KEY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function legacyAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret && Buffer.byteLength(secret) >= 32) return secret;
  throw new Error("AUTH_SECRET with at least 32 bytes is required for booking manage sessions.");
}

function parsedKeyring() {
  const raw = process.env.BOOKING_CAPABILITY_KEYRING;
  if (!raw) return new Map<string, string>();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("BOOKING_CAPABILITY_KEYRING must be a JSON object."); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("BOOKING_CAPABILITY_KEYRING must be a JSON object.");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 8) throw new Error("BOOKING_CAPABILITY_KEYRING may retain at most 8 keys.");
  const result = new Map<string, string>();
  for (const [keyId, secret] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new Error("Every booking capability keyring entry requires a valid key id and at least 32 bytes.");
    result.set(keyId, secret);
  }
  return result;
}

function currentCapabilityKey() {
  const keyId = process.env.BOOKING_CAPABILITY_KEY_ID;
  const secret = process.env.BOOKING_CAPABILITY_SECRET;
  if (keyId || secret) {
    if (!keyId || !KEY_ID_PATTERN.test(keyId) || !secret || Buffer.byteLength(secret) < 32) throw new Error("BOOKING_CAPABILITY_KEY_ID and BOOKING_CAPABILITY_SECRET (at least 32 bytes) are required together.");
    return { keyId, secret };
  }
  if (process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production") return { keyId: DEMO_KEY_ID, secret: "tempocove-explicit-demo-capability-secret-2026" };
  throw new Error("An independent BOOKING_CAPABILITY_KEY_ID and BOOKING_CAPABILITY_SECRET are required.");
}

function capabilitySecretFor(keyId: string) {
  let current: ReturnType<typeof currentCapabilityKey> | null = null;
  try { current = currentCapabilityKey(); } catch { /* a retained or legacy key may still be valid */ }
  if (current?.keyId === keyId) return current.secret;
  const retained = parsedKeyring().get(keyId);
  if (retained) return retained;
  if (keyId === LEGACY_AUTH_KEY_ID) {
    try { return legacyAuthSecret(); } catch { return null; }
  }
  if (keyId === DEMO_KEY_ID && process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production") return "tempocove-explicit-demo-capability-secret-2026";
  return null;
}
function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function tokenFor(bookingId: string, scope: BookingCapabilityScope, version: string, expiresAt: Date, keyId: string) {
  const secret = capabilitySecretFor(keyId);
  if (!secret) return null;
  const payload = `${bookingId}.${scope}.${version}.${expiresAt.getTime()}.${keyId}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function newCapabilityIdentity(lifecycleEnd: Date, now = new Date()) {
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const { keyId } = currentCapabilityKey();
  return { version: randomBytes(18).toString("base64url"), keyId, expiresAt: new Date(Math.max(now.getTime() + thirtyDays, lifecycleEnd.getTime() + thirtyDays)) };
}

export function materializeCapabilities(bookingId: string, version: string, expiresAt: Date, keyId = LEGACY_AUTH_KEY_ID): BookingManageCapabilities | null {
  const tokens = Object.fromEntries(scopes.map((scope) => [scope, tokenFor(bookingId, scope, version, expiresAt, keyId)])) as Record<BookingCapabilityScope, string | null>;
  if (scopes.some((scope) => !tokens[scope])) return null;
  return {
    read: tokens.read!,
    cancel: tokens.cancel!,
    reschedule: tokens.reschedule!,
    expiresAt: expiresAt.toISOString(),
  };
}

export function capabilityRows(bookingId: string, version: string, expiresAt: Date, keyId = LEGACY_AUTH_KEY_ID) {
  return scopes.map((scope) => {
    const token = tokenFor(bookingId, scope, version, expiresAt, keyId);
    if (!token) throw new Error(`Booking capability key '${keyId}' is unavailable.`);
    return { bookingId, scope, tokenHash: hash(token), expiresAt };
  });
}

export async function requireBookingCapability(bookingId: string, scope: BookingCapabilityScope, token: string) {
  enterCapabilityDatabaseContext(bookingId);
  if (!token || token.length > 600) throw notFound("Booking");
  const suppliedHash = hash(token);
  const record = await db.bookingCapability.findUnique({ where: { tokenHash: suppliedHash } });
  if (!record || record.bookingId !== bookingId || record.scope !== scope || record.revokedAt || record.expiresAt <= new Date()) throw notFound("Booking");
  const supplied = Buffer.from(suppliedHash);
  const expected = Buffer.from(record.tokenHash);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw notFound("Booking");
  return record;
}

export async function exchangeBookingCapabilities(bookingId: string, supplied: Pick<BookingManageCapabilities, "read" | "cancel" | "reschedule">, now = new Date()) {
  enterCapabilityDatabaseContext(bookingId);
  const suppliedRows = scopes.map((scope) => ({ scope, tokenHash: hash(supplied[scope]) }));
  const sessionToken = createHmac("sha256", legacyAuthSecret()).update(`manage-session-v1\0${bookingId}\0${suppliedRows.map((item) => `${item.scope}:${item.tokenHash}`).join("\0")}`).digest("base64url");
  const sessionTokenHash = hash(sessionToken);
  let expiresAt = now;
  await db.$transaction(async (tx) => {
    const records = await tx.bookingCapability.findMany({ where: { bookingId, expiresAt: { gt: now }, tokenHash: { in: suppliedRows.map((item) => item.tokenHash) } } });
    if (records.length !== scopes.length || suppliedRows.some((item) => !records.some((record) => record.scope === item.scope && record.tokenHash === item.tokenHash))) throw notFound("Booking");
    const boundedExpiry = new Date(Math.min(...records.map((record) => record.expiresAt.getTime()))); expiresAt = boundedExpiry;
    const existing = await tx.bookingManageSession.findUnique({ where: { tokenHash: sessionTokenHash } });
    const activeCount = records.filter((record) => record.revokedAt === null).length;
    if (activeCount !== scopes.length || existing?.acknowledgedAt || existing?.revokedAt || existing && existing.bookingId !== bookingId) throw notFound("Booking");
    if (!existing) await tx.bookingManageSession.create({ data: { bookingId, tokenHash: sessionTokenHash, scopes: scopes.join(","), expiresAt: boundedExpiry, createdAt: now } });
  });
  return { token: sessionToken, expiresAt };
}

function cookieValue(request: Request, bookingId: string) {
  const name = manageCookieName(bookingId);
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

export async function requireBookingManageSession(request: Request, bookingId: string, scope: BookingCapabilityScope) {
  enterCapabilityDatabaseContext(bookingId);
  const token = cookieValue(request, bookingId);
  if (!token) throw notFound("Booking");
  const record = await db.bookingManageSession.findFirst({ where: { bookingId, tokenHash: hash(token), acknowledgedAt: scope === "read" ? undefined : { not: null }, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!record || !record.scopes.split(",").includes(scope)) throw notFound("Booking");
  return record;
}

export async function acknowledgeBookingManageSession(request: Request, bookingId: string, now = new Date()) {
  enterCapabilityDatabaseContext(bookingId);
  const token = cookieValue(request, bookingId); if (!token) throw notFound("Booking"); const tokenHash = hash(token);
  await db.$transaction(async (tx) => {
    const session = await tx.bookingManageSession.findFirst({ where: { bookingId, tokenHash, revokedAt: null, expiresAt: { gt: now } } });
    if (!session) throw notFound("Booking");
    if (session.acknowledgedAt) return;
    const active = await tx.bookingCapability.findMany({ where: { bookingId, revokedAt: null, expiresAt: { gt: now } } });
    if (active.length !== scopes.length || scopes.some((scope) => !active.some((item) => item.scope === scope))) throw notFound("Booking");
    const acknowledged = await tx.bookingManageSession.updateMany({ where: { id: session.id, acknowledgedAt: null, revokedAt: null }, data: { acknowledgedAt: now } });
    const revoked = await tx.bookingCapability.updateMany({ where: { id: { in: active.map((item) => item.id) }, revokedAt: null }, data: { revokedAt: now } });
    if (acknowledged.count !== 1 || revoked.count !== scopes.length) throw notFound("Booking");
  });
  return { acknowledged: true as const };
}

export const manageCookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/" };
