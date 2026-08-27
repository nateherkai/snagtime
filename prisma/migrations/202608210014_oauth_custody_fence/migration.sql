ALTER TABLE "OAuthState" ADD COLUMN "expectedConnectionId" TEXT;

CREATE INDEX "OAuthState_expectedConnectionId_idx" ON "OAuthState"("expectedConnectionId");
