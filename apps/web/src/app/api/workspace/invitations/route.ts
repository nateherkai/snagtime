import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { invitationInput } from "@/server/validation";
import { createWorkspaceInvitation, listWorkspaceInvitations } from "@/server/services/accounts";
import { enforceRateLimit } from "@/server/rate-limit";

export async function GET(request: Request) {
  try { const access = await requireWorkspaceAccess(request, "ADMIN"); return ok(await listWorkspaceInvitations(access.workspaceId)); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); await enforceRateLimit(`invite:workspace:${access.workspaceId}`, 30, 60 * 60_000); const input = invitationInput.parse(await jsonBody(request)); return ok(await createWorkspaceInvitation(access, input.email, input.role), { status: 202 }); } catch (error) { return apiError(error); }
}
