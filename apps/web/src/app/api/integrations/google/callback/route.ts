import { getSessionRecord } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { apiError } from "@/server/http";
import { consumeGoogleAuthorization } from "@/server/services/calendar";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";

export async function GET(request: Request) {
  try {
    const session = await getSessionRecord(request); await enforceRateLimit(`google-callback:${session ? `user:${session.userId}` : clientAddress(request)}`, 20, 15 * 60_000);
    const query = new URL(request.url).searchParams; const code = query.get("code"); const state = query.get("state");
    if (!session || !code || code.length > 2048 || !state || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new AppError("INVALID_OAUTH_CALLBACK", "Google authorization could not be verified.", 400);
    await consumeGoogleAuthorization(session.userId, session.id, state, code);
    return Response.redirect(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/integrations?google=connected`);
  } catch (error) { return apiError(error); }
}
