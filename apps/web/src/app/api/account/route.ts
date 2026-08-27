import { requireWorkspaceAccess } from "@/server/auth/session";
import { apiError, ok } from "@/server/http";
import { getAccountSummary } from "@/server/services/accounts";

export async function GET(request: Request) {
  try { return ok(await getAccountSummary(await requireWorkspaceAccess(request))); } catch (error) { return apiError(error); }
}
