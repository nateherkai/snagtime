import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { disconnectGoogleCalendar, googleCalendarStatus } from "@/server/services/calendar";

export async function GET(request: Request) {
  try { const access = await requireWorkspaceAccess(request); return ok(await googleCalendarStatus(access.user.id, access.workspaceId)); } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); return ok(await disconnectGoogleCalendar(access.user.id, undefined, new Date(), access.workspaceId)); } catch (error) { return apiError(error); }
}
