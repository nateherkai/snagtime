import { assertSameOrigin, requireSessionRecord } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { createGoogleAuthorization } from "@/server/services/calendar";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  try { assertSameOrigin(request); const session = await requireSessionRecord(request); await enforceRateLimit(`google-oauth:workspace:${session.activeWorkspaceId}`, 10, 60 * 60_000); return ok({ authorizationUrl: await createGoogleAuthorization(session.userId, session.id, session.activeWorkspaceId) }); } catch (error) { return apiError(error); }
}
