import { apiError, jsonBody, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/auth/session";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { tokenInput } from "@/server/validation";
import { verifyEmail } from "@/server/services/account-recovery";
export async function POST(request: Request) { try { assertSameOrigin(request); await enforceRateLimit(`verify-email-consume:ip:${clientAddress(request)}`, 20, 60 * 60_000); return ok(await verifyEmail(tokenInput.parse(await jsonBody(request)).token)); } catch (error) { return apiError(error); } }
