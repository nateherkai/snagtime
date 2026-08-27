import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { getAccountSummary, updateMembershipRole } from "@/server/services/accounts";
import { z } from "zod";

export async function GET(request: Request) {
  try { return ok((await getAccountSummary(await requireWorkspaceAccess(request))).members); } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { const access = await requireWorkspaceMutationAccess(request, "OWNER"); const input = z.object({ membershipId: z.string().min(1), role: z.enum(["OWNER","ADMIN","MEMBER"]), status: z.enum(["ACTIVE","REMOVED"]) }).strict().parse(await jsonBody(request)); await updateMembershipRole(access, input.membershipId, input.role, input.status); return ok({ updated: true as const }); } catch (error) { return apiError(error); }
}
