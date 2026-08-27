import { DateTime, IANAZone } from "luxon";
import { requireBookingManageSession } from "@/server/auth/capabilities";
import { getSessionRecord } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { AppError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";
import { getBookingForHost, listManageRescheduleSlots } from "@/server/services/bookings";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params;
    const organizer = await getSessionRecord(request);
    const authorityKey = organizer ? (await getBookingForHost(organizer.activeWorkspaceId, id), `organizer:${organizer.id}`) : `manage:${id}:${(await requireBookingManageSession(request, id, "reschedule")).id}`;
    await enforceRateLimit(`manage-slots:${authorityKey}`, 240, 60_000);
    const url = new URL(request.url); const timeZone = url.searchParams.get("timeZone") || "UTC";
    if (!IANAZone.isValidZone(timeZone)) throw new AppError("INVALID_TIME_ZONE", "Choose a valid IANA time zone.", 400);
    const from = DateTime.fromISO(url.searchParams.get("from") || "", { zone: "utc" });
    const to = DateTime.fromISO(url.searchParams.get("to") || "", { zone: "utc" });
    if (!from.isValid || !to.isValid || to <= from || to.diff(from, "days").days > 31) throw new AppError("INVALID_SLOT_RANGE", "Choose a valid slot range of no more than 31 days.", 400);
    return ok(await listManageRescheduleSlots(id, from.toJSDate(), to.toJSDate(), timeZone, url.searchParams.get("durationId") || undefined));
  } catch (error) { return apiError(error); }
}
