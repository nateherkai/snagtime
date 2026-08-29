import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { runWithDatabaseContext } from "@/server/db-context";
import { apiError, ok } from "@/server/http";
import { disconnectGoogleCalendar, googleCalendarStatus } from "@/server/services/calendar";

function workspaceReadContext(access: { workspaceId: string; user: { id: string }; sessionHash?: string; role: string }) {
  return { mode: "workspace" as const, workspaceId: access.workspaceId, userId: access.user.id, sessionHash: access.sessionHash, subject: access.role, action: "workspace_read" };
}

export async function GET(request: Request) {
  try {
    const access = await requireWorkspaceAccess(request);
    return runWithDatabaseContext(workspaceReadContext(access), async () => ok(await googleCalendarStatus(access.user.id, access.workspaceId)));
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    const access = await requireWorkspaceMutationAccess(request, "ADMIN");
    return runWithDatabaseContext({ ...workspaceReadContext(access), action: "oauth_write", subject: "ADMIN" }, async () => ok(await disconnectGoogleCalendar(access.user.id, undefined, new Date(), access.workspaceId)));
  } catch (error) { return apiError(error); }
}
