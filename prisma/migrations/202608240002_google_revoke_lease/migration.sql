ALTER TABLE "OAuthConnection" ADD COLUMN "disconnectLeaseToken" TEXT;
ALTER TABLE "OAuthConnection" ADD COLUMN "disconnectLeaseExpiresAt" DATETIME;

CREATE INDEX "OAuthConnection_disconnectStatus_disconnectRetryAt_idx" ON "OAuthConnection"("disconnectStatus", "disconnectRetryAt");
CREATE INDEX "OAuthConnection_disconnectStatus_disconnectLeaseExpiresAt_idx" ON "OAuthConnection"("disconnectStatus", "disconnectLeaseExpiresAt");
