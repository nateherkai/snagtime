import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { deleteEventType, getEventTypeById, updateEventType } from "@/server/services/event-types";
import { apiError, jsonBody, ok } from "@/server/http";
import { updateEventTypeInput } from "@/server/validation";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const access = await requireWorkspaceAccess(request); const { id } = await context.params; return ok(await getEventTypeById(access.workspaceId, id)); } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); const { id } = await context.params; return ok(await updateEventType(access.workspaceId, access.user.id, id, updateEventTypeInput.parse(await jsonBody(request)))); } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); const { id } = await context.params; await deleteEventType(access.workspaceId, id, access.user.id); return ok({ deleted: true as const }); } catch (error) { return apiError(error); }
}
