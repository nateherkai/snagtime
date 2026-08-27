import { AppError } from "@/server/errors";
import { apiError, ok } from "@/server/http";
import { listPublicSlots } from "@/server/services/bookings";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { slug } = await context.params;
    await enforceRateLimit(`public-slots:${clientAddress(request)}`, 120, 60_000);
    const query = new URL(request.url).searchParams;
    const from = new Date(query.get("from") || ""); const to = new Date(query.get("to") || ""); const timeZone = query.get("timeZone") || "UTC";
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 31 * 86400000) throw new AppError("INVALID_RANGE", "Choose a valid date range of 31 days or less.");
    try { Intl.DateTimeFormat(undefined, { timeZone }); } catch { throw new AppError("INVALID_TIME_ZONE", "Choose a valid time zone."); }
    const durationId = query.get("durationId") || undefined;
    return ok(await listPublicSlots(slug, from, to, timeZone, undefined, durationId));
  } catch (error) { return apiError(error); }
}
