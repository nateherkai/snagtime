import { apiError, ok } from "@/server/http";
import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { listLocalInbox, processEmailOutbox } from "@/server/services/notifications";
export async function GET(request: Request) { try { const access = await requireWorkspaceAccess(request, "ADMIN"); return ok(await listLocalInbox(access.workspaceId)); } catch (error) { return apiError(error); } }
export async function POST(request: Request) { try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); return ok(await processEmailOutbox(access.workspaceId)); } catch (error) { return apiError(error); } }
