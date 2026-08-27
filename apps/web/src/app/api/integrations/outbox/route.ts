import { requireWorkspaceMutationAccess } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { processOutbox } from "@/server/services/outbox";
import { processEmailOutbox } from "@/server/services/notifications";

export async function POST(request: Request) {
  try {
    const access = await requireWorkspaceMutationAccess(request, "ADMIN"); await enforceRateLimit(`outbox:workspace:${access.workspaceId}`, 10, 60_000);
    const [integrations, email] = await Promise.all([processOutbox(access.workspaceId), processEmailOutbox(access.workspaceId)]); return ok({ integrations, email });
  } catch (error) { return apiError(error); }
}
