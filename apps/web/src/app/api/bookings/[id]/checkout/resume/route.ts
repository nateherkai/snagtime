import { requireBookingManageSession } from "@/server/auth/capabilities";
import { assertSameOrigin } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { resumeBookingCheckout } from "@/server/services/bookings";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const session = await requireBookingManageSession(request, id, "read");
    await enforceRateLimit(`checkout-resume:${id}:${session.id}`, 30, 15 * 60_000);
    const response = ok(await resumeBookingCheckout(id));
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return apiError(error); }
}
