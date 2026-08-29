import { requireWorkspaceMutationAccess } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { completeWorkspaceOnboarding, getAccountSummary } from "@/server/services/accounts";
import { workspaceUpdateInput } from "@/server/validation";

export async function PATCH(request: Request) {
  try {
    const payload = await jsonBody(request);
    workspaceUpdateInput.parse(payload);
    const access = await requireWorkspaceMutationAccess(request, "ADMIN");
    await completeWorkspaceOnboarding(access);
    return ok(await getAccountSummary({ ...access, workspace: { ...access.workspace, onboardingCompletedAt: new Date() } }));
  } catch (error) { return apiError(error); }
}
