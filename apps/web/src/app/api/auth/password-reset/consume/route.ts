import { apiError, jsonBody, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/auth/session";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { passwordResetInput } from "@/server/validation";
import { resetPassword } from "@/server/services/account-recovery";
export async function POST(request: Request) { try { assertSameOrigin(request); await enforceRateLimit(`password-reset-consume:ip:${clientAddress(request)}`, 12, 60 * 60_000); const input = passwordResetInput.parse(await jsonBody(request)); return ok(await resetPassword(input.token, input.newPassword)); } catch (error) { return apiError(error); } }
