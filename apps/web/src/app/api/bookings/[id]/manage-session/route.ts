import { assertSameOrigin } from "@/server/auth/session";
import { acknowledgeBookingManageSession, exchangeBookingCapabilities, manageCookieName, manageCookieOptions } from "@/server/auth/capabilities";
import { apiError, jsonBody, ok } from "@/server/http";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { bookingCapabilityExchangeInput } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); await enforceRateLimit(`manage-exchange:${clientAddress(request)}`, 12, 15 * 60_000);
    const { id } = await context.params; const bundle = bookingCapabilityExchangeInput.parse(await jsonBody(request));
    const session = await exchangeBookingCapabilities(id, bundle);
    const response = ok({ established: true as const });
    response.cookies.set(manageCookieName(id), session.token, { ...manageCookieOptions, expires: session.expiresAt });
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const { id } = await context.params;
    await enforceRateLimit(`manage-ack:${clientAddress(request)}`, 30, 15 * 60_000);
    return ok(await acknowledgeBookingManageSession(request, id));
  } catch (error) { return apiError(error); }
}
