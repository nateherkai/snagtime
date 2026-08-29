import type { WorkspaceBranding } from "@/lib/contracts";
import { db } from "@/server/db";
import { enterDatabaseAction } from "@/server/db-context";
import { canonicalizeImageDataUrl, isRemoteImageUrl } from "@/server/image-ingestion";
import { AppError } from "@/server/errors";

export async function getBranding(workspaceId: string): Promise<WorkspaceBranding> {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, include: { branding: true } });
  return workspace.branding ?? { workspaceName: workspace.name, logoUrl: null, accentColor: "#2563EB", description: null, footerText: null };
}

export async function setBranding(workspaceId: string, userId: string, input: WorkspaceBranding) {
  enterDatabaseAction("branding_write", { workspaceId, userId });
  const canonicalLogo = input.logoUrl && !isRemoteImageUrl(input.logoUrl) ? await canonicalizeImageDataUrl(input.logoUrl, "logoUrl") : input.logoUrl;
  return db.$transaction(async (tx) => {
    const existing = await tx.workspaceBranding.findUnique({ where: { workspaceId }, select: { logoUrl: true } });
    if (canonicalLogo && isRemoteImageUrl(canonicalLogo) && canonicalLogo !== existing?.logoUrl) throw new AppError("INVALID_IMAGE", "Remote image URLs cannot be saved. Upload the image file instead.", 422, { logoUrl: ["Remote image URLs cannot be saved. Upload the image file instead."] });
    const persistedInput = { ...input, logoUrl: canonicalLogo };
    await tx.workspace.update({ where: { id: workspaceId }, data: { name: input.workspaceName } });
    return tx.workspaceBranding.upsert({ where: { workspaceId }, update: persistedInput, create: { ...persistedInput, workspaceId, userId } });
  });
}
