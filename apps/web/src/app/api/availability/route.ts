import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { getAvailability, setAvailability } from "@/server/services/availability";
import { apiError, jsonBody, ok } from "@/server/http";
import { availabilityInput } from "@/server/validation";

export async function GET(request: Request) {
  try { const access = await requireWorkspaceAccess(request); return ok(await getAvailability(access.workspaceId, access.user.id)); } catch (error) { return apiError(error); }
}
export async function PUT(request: Request) {
  try { const access = await requireWorkspaceMutationAccess(request); return ok(await setAvailability(access.workspaceId, access.user.id, availabilityInput.parse(await jsonBody(request)))); } catch (error) { return apiError(error); }
}
