import { requireBookingManageSession } from "@/server/auth/capabilities";
import { assertSameOrigin, getSessionRecord } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { cancelBooking, getBookingDetail, getBookingForHost, rescheduleBooking } from "@/server/services/bookings";
import { cancelBookingInput, rescheduleBookingInput } from "@/server/validation";
import { clientAddress, enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ id: string }> };
async function authorize(request: Request, id: string, scope: "read" | "cancel" | "reschedule") {
  const organizer = await getSessionRecord(request);
  if (organizer) { await getBookingForHost(organizer.activeWorkspaceId, id); return `organizer:${organizer.id}`; }
  const session = await requireBookingManageSession(request, id, scope); return `manage:${id}:${session.id}`;
}

export async function GET(request: Request, context: Context) {
  try {
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params; const authorityKey = await authorize(request, id, "read");
    await enforceRateLimit(`manage-booking:${authorityKey}`, 120, 60_000);
    return ok(await getBookingDetail(id));
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params; const body = rescheduleBookingInput.parse(await jsonBody(request));
    const authorityKey = await authorize(request, id, "reschedule"); await enforceRateLimit(`manage-booking:${authorityKey}`, 120, 60_000); return ok(await rescheduleBooking(id, body.startAt));
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(`manage-attempt:ip:${clientAddress(request)}`,240,60_000);
    const { id } = await context.params; const body = cancelBookingInput.parse(await jsonBody(request));
    const authorityKey = await authorize(request, id, "cancel"); await enforceRateLimit(`manage-booking:${authorityKey}`, 120, 60_000); return ok(await cancelBooking(id, body.reason));
  } catch (error) { return apiError(error); }
}
