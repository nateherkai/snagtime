import { apiError, jsonBody, ok } from "@/server/http";
import { createBooking } from "@/server/services/bookings";
import { bookingInput } from "@/server/validation";
import { AppError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { exchangeBookingCapabilities, manageCookieName, manageCookieOptions } from "@/server/auth/capabilities";

type Context = { params: Promise<{ slug: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const { slug } = await context.params;
    // The untrusted local-demo bucket is intentionally fixed and bounded, but large enough for a room of demo users.
    await enforceRateLimit(`public-booking:${clientAddress(request)}`, 120, 60_000);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new AppError("INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required.", 400);
    const created = await createBooking(slug, bookingInput.parse(await jsonBody(request)), idempotencyKey);
    let session: Awaited<ReturnType<typeof exchangeBookingCapabilities>> | null = null;
    if (created.manageCapabilities) session = await exchangeBookingCapabilities(created.booking.id, created.manageCapabilities);
    const response = ok({
      bookingId: created.booking.id, status: created.booking.status, checkoutUrl: created.checkoutUrl, checkoutState: created.checkoutState,
      manageSessionEstablished: Boolean(session), manageCapabilities: null,
    }, { status: 201 });
    if (session) response.cookies.set(manageCookieName(created.booking.id), session.token, { ...manageCookieOptions, expires: session.expiresAt });
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return apiError(error); }
}
