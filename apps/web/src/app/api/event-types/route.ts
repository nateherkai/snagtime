import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { createEventType, listEventTypes } from "@/server/services/event-types";
import { apiError, jsonBody, ok } from "@/server/http";
import { eventTypeInput } from "@/server/validation";

export async function GET(request: Request) {
  try { const access = await requireWorkspaceAccess(request); return ok(await listEventTypes(access.workspaceId)); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); return ok(await createEventType(access.workspaceId, access.user.id, eventTypeInput.parse(await jsonBody(request))), { status: 201 }); } catch (error) { return apiError(error); }
}
