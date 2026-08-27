import { AppError } from "@/server/errors";
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { createHmac } from "node:crypto";
import { db } from "@/server/db";

type Counter = { count: number; resetsAt: number };
const counters = new Map<string, Counter>();
const MAX_COUNTERS = 2_048;
let callsSinceSweep = 0;

export function clientAddress(request: Request) {
  if (process.env.TRUST_PROXY !== "true") return "anonymous-local";
  const expected = process.env.PROXY_SHARED_SECRET; const supplied = request.headers.get("x-tempocove-proxy-secret");
  if (!expected || Buffer.byteLength(expected) < 32 || !supplied) return "global-untrusted-proxy";
  const expectedBytes = Buffer.from(expected); const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return "global-untrusted-proxy";
  const candidate = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return candidate && isIP(candidate) ? candidate : "global-untrusted-proxy";
}

function enforceLocalRateLimit(key: string, limit: number, windowMs: number, now: number) {
  callsSinceSweep += 1;
  if (callsSinceSweep >= 100 || counters.size > 1_000) {
    for (const [storedKey, value] of counters) if (value.resetsAt <= now) counters.delete(storedKey);
    callsSinceSweep = 0;
  }
  const current = counters.get(key);
  if (!current || current.resetsAt <= now) {
    if (!current && counters.size >= MAX_COUNTERS) {
      const oldest = counters.keys().next().value as string | undefined;
      if (oldest) counters.delete(oldest);
    }
    counters.set(key, { count: 1, resetsAt: now + windowMs });
    return;
  }
  if (current.count >= limit) throw new AppError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  current.count += 1;
}

export function rateKeyHash(key: string) {
  if (!key || key.length > 512) throw new AppError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  const secret = process.env.RATE_LIMIT_HASH_SECRET || ""; if (Buffer.byteLength(secret) < 32) throw new Error("RATE_LIMIT_HASH_SECRET must contain at least 32 bytes.");
  return createHmac("sha256", secret).update(`tempocove-rate-v1\0${key}`).digest("hex");
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Invalid rate-limit policy.");
  if (process.env.RATE_LIMIT_PROVIDER !== "postgresql") {
    if (process.env.NODE_ENV === "production") throw new Error("Production refuses the process-local rate limiter.");
    enforceLocalRateLimit(key, limit, windowMs, now); return;
  }
  const keyHash = rateKeyHash(key); const at = new Date(now); const windowEnd = new Date(now + windowMs);
  try {
    const result = await db.$queryRawUnsafe<Array<{ accepted: boolean }>>("SELECT tempocove_rate_limit($1::text,$2::integer,$3::timestamptz,$4::timestamptz) AS accepted", keyHash, limit, at, windowEnd);
    if (result[0]?.accepted !== true) throw new AppError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("RATE_LIMIT_UNAVAILABLE", "Request protection is temporarily unavailable.", 503);
  }
}

export function resetRateLimitsForTest() { counters.clear(); callsSinceSweep = 0; }
export function rateLimitCounterCountForTest() { return counters.size; }
export const rateLimitMaximumCountersForTest = MAX_COUNTERS;
