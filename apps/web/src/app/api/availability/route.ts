import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { runWithDatabaseContext } from "@/server/db-context";
import { getAvailability, setAvailability } from "@/server/services/availability";
import { apiError, jsonBody, ok } from "@/server/http";
import { availabilityInput } from "@/server/validation";

function workspaceContext(access: { workspaceId: string; user: { id: string }; sessionHash?: string; role: string }, action: string) {
  return { mode: "workspace" as const, workspaceId: access.workspaceId, userId: access.user.id, sessionHash: access.sessionHash, subject: access.role, action };
}

export async function GET(request: Request) {
  try {
    const access = await requireWorkspaceAccess(request);
    return runWithDatabaseContext(workspaceContext(access, "workspace_read"), async () => ok(await getAvailability(access.workspaceId, access.user.id)));
  } catch (error) { return apiError(error); }
}
export async function PUT(request: Request) {
  try {
    const payload = availabilityInput.parse(await jsonBody(request));
    const access = await requireWorkspaceMutationAccess(request);
    return runWithDatabaseContext(workspaceContext(access, "availability_write"), async () => ok(await setAvailability(access.workspaceId, access.user.id, payload)));
  } catch (error) { return apiError(error); }
}
