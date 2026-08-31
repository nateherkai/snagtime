ALTER TABLE "User" ADD COLUMN "councilForgeUserId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "councilForgeCompanyId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "councilForgeEdgeId" TEXT;

CREATE UNIQUE INDEX "User_councilForgeUserId_key" ON "User"("councilForgeUserId");
CREATE UNIQUE INDEX "Workspace_councilForgeCompanyId_key" ON "Workspace"("councilForgeCompanyId");
CREATE UNIQUE INDEX "Workspace_councilForgeEdgeId_key" ON "Workspace"("councilForgeEdgeId");

CREATE TABLE "CouncilForgeSsoReplay" (
  "jti" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CouncilForgeSsoReplay_expiresAt_idx" ON "CouncilForgeSsoReplay"("expiresAt");
