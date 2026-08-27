import { requireWorkspaceMutationAccess, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { passwordChangeInput } from "@/server/validation";
import { changeAccountPassword } from "@/server/services/accounts";
import { enforceRateLimit } from "@/server/rate-limit";

export async function PATCH(request: Request) {
  try {
    const access = await requireWorkspaceMutationAccess(request); await enforceRateLimit(`password:user:${access.user.id}`, 5, 60 * 60_000);
    const input = passwordChangeInput.parse(await jsonBody(request)); const token = await changeAccountPassword(access, input.currentPassword, input.newPassword);
    const response = ok({ changed: true as const, signedOutOtherSessions: true as const }); response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions); return response;
  } catch (error) { return apiError(error); }
}
