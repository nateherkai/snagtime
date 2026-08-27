import { apiError, jsonBody, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/auth/session";
import { registrationInput } from "@/server/validation";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { registerAccount } from "@/server/services/accounts";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const input = registrationInput.parse(await jsonBody(request));
    await enforceRateLimit(`register:ip:${clientAddress(request)}`, 5, 60 * 60_000); await enforceRateLimit(`register:account:${input.email}`, 3, 60 * 60_000);
    await registerAccount(input);
    return ok({ accepted: true as const, verificationPending: true as const }, { status: 202 });
  } catch (error) { return apiError(error); }
}
