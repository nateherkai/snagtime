import { db } from "@/server/db";
import { apiError, jsonBody, ok } from "@/server/http";
import { mapUser } from "@/server/mappers";
import { assertSameOrigin, createSessionForUser, getSessionRecord, revokeRequestSession, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { demoLoginInput } from "@/server/validation";
import { AppError } from "@/server/errors";
import { verifyPassword } from "@/server/auth/password";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { enterAuthDatabaseContext } from "@/server/db-context";

function loginRoleRank(role: string) { return role === "OWNER" ? 3 : role === "ADMIN" ? 2 : 1; }
const DUMMY_LOGIN_HASH = `scrypt:v1:${Buffer.alloc(16).toString("base64url")}:${Buffer.alloc(32).toString("base64url")}`;

export async function GET(request: Request) {
  try { const session = await getSessionRecord(request); return ok({ user: session ? mapUser(session.user) : null, workspace: session ? { id: session.workspace.id, name: session.workspace.name, timeZone: session.workspace.timeZone, role: session.membership.role, onboardingCompleted: Boolean(session.workspace.onboardingCompletedAt) } : null }); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { email, password } = demoLoginInput.parse(await jsonBody(request));
    await enforceRateLimit(`login:ip:${clientAddress(request)}`, 12, 15 * 60_000); await enforceRateLimit(`login:account:${email}`, 8, 15 * 60_000);
    enterAuthDatabaseContext(email);
    const user = await db.user.findUnique({ where: { email }, include: { memberships: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } } } });
    const membership = user?.memberships.sort((left, right) => loginRoleRank(right.role) - loginRoleRank(left.role))[0];
    const passwordValid = await verifyPassword(password, user?.passwordHash || DUMMY_LOGIN_HASH);
    if (!user || !membership || !passwordValid || !user.emailVerifiedAt) throw new AppError("AUTHENTICATION_FAILED", "Email or password is invalid.", 401);
    enterAuthDatabaseContext(email, user.id, membership.workspaceId);
    const response = ok({ user: mapUser(user) });
    response.cookies.set(SESSION_COOKIE, await createSessionForUser(user.id, membership.id), sessionCookieOptions);
    return response;
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeRequestSession(request);
    const response = ok({ signedOut: true as const });
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    return response;
  } catch (error) { return apiError(error); }
}
