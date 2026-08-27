import { afterEach, describe, expect, it } from "vitest";
import { createSessionForUser, createSessionToken, readSessionToken } from "@/server/auth/session";
import { db } from "@/server/db";

const originalSecret = process.env.AUTH_SECRET;
afterEach(() => { process.env.AUTH_SECRET = originalSecret; });

describe("demo session tokens", () => {
  it("round-trips an authenticated user and expiration", () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-session-signing";
    const token = createSessionToken("user_1", 1_000);
    expect(readSessionToken(token, 2_000)?.userId).toBe("user_1");
  });

  it("rejects tampering and expiration", () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-session-signing";
    const token = createSessionToken("user_1", 1_000);
    expect(readSessionToken(`${token.slice(0, -1)}x`, 2_000)).toBeNull();
    expect(readSessionToken(token, 1_000 + 15 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("rotates persisted sessions so a second login revokes the first", async () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-session-signing";
    const user = await db.user.findFirstOrThrow();
    await db.authSession.deleteMany({ where: { userId: user.id } });
    const first = await createSessionForUser(user.id); const second = await createSessionForUser(user.id);
    expect(first).not.toBe(second);
    expect(await db.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect(await db.authSession.count({ where: { userId: user.id, revokedAt: { not: null } } })).toBe(1);
    await db.authSession.deleteMany({ where: { userId: user.id } });
  });
});
