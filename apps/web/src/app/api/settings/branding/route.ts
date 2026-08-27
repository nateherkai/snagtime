import { requireWorkspaceAccess, requireWorkspaceMutationAccess } from "@/server/auth/session";
import { apiError, jsonBody, ok } from "@/server/http";
import { getBranding, setBranding } from "@/server/services/branding";
import { brandingInput } from "@/server/validation";
import { IMAGE_JSON_BODY_MAX_BYTES } from "@/server/image-ingestion";

export async function GET(request: Request) {
  try { const access = await requireWorkspaceAccess(request); return ok(await getBranding(access.workspaceId)); } catch (error) { return apiError(error); }
}
export async function PUT(request: Request) {
  try { const access = await requireWorkspaceMutationAccess(request, "ADMIN"); return ok(await setBranding(access.workspaceId, access.user.id, brandingInput.parse(await jsonBody(request, IMAGE_JSON_BODY_MAX_BYTES)))); } catch (error) { return apiError(error); }
}
