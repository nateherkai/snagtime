import { apiError, jsonBody, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/auth/session";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { genericEmailInput } from "@/server/validation";
import { requestPasswordReset } from "@/server/services/account-recovery";
import { assertLocalAccountAuthorityAllowed } from "@/server/auth/councilforge";
export async function POST(request: Request) { try { assertSameOrigin(request); assertLocalAccountAuthorityAllowed(); const input = genericEmailInput.parse(await jsonBody(request)); await enforceRateLimit(`password-reset:ip:${clientAddress(request)}`, 8, 60 * 60_000); await enforceRateLimit(`password-reset:account:${input.email}`, 4, 60 * 60_000); return ok(await requestPasswordReset(input.email), { status: 202 }); } catch (error) { return apiError(error); } }
