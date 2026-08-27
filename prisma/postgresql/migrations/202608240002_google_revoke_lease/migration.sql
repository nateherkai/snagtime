ALTER TABLE "OAuthConnection" ADD COLUMN IF NOT EXISTS "disconnectLeaseToken" TEXT;
ALTER TABLE "OAuthConnection" ADD COLUMN IF NOT EXISTS "disconnectLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "OAuthConnection_disconnectStatus_disconnectRetryAt_idx" ON "OAuthConnection" ("disconnectStatus", "disconnectRetryAt");
CREATE INDEX IF NOT EXISTS "OAuthConnection_disconnectStatus_disconnectLeaseExpiresAt_idx" ON "OAuthConnection" ("disconnectStatus", "disconnectLeaseExpiresAt");

GRANT UPDATE("accessToken","refreshToken","expiresAt","disconnectStatus","disconnectRetryAt","disconnectLeaseToken","disconnectLeaseExpiresAt","disconnectErrorCode","updatedAt") ON "OAuthConnection" TO tempocove_worker;
