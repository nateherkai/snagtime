import { apiError, jsonBody, ok } from "@/server/http";
import { rotateSessionWorkspace, SESSION_COOKIE, sessionCookieOptions, requireWorkspaceAccess } from "@/server/auth/session";
import { workspaceSwitchInput } from "@/server/validation";
import { getAccountSummary } from "@/server/services/accounts";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  try {
    const input = workspaceSwitchInput.parse(await jsonBody(request)); const current = await requireWorkspaceAccess(request); await enforceRateLimit(`workspace-switch:user:${current.user.id}`, 30, 60_000);
    const token = await rotateSessionWorkspace(request, input.workspaceId);
    const membership = await (await import("@/server/db")).db.membership.findFirstOrThrow({ where: { workspaceId: input.workspaceId, userId: current.user.id, status: "ACTIVE" }, include: { workspace: true } });
    const response = ok(await getAccountSummary({ sessionId: "rotated", user: current.user, workspaceId: membership.workspaceId, workspace: membership.workspace, membership, role: membership.role as typeof current.role })); response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions); return response;
  } catch (error) { return apiError(error); }
}
