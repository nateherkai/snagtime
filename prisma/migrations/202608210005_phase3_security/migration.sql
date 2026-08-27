CREATE TABLE "BookingManageSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopes" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingManageSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BookingManageSession_tokenHash_key" ON "BookingManageSession"("tokenHash");
CREATE INDEX "BookingManageSession_bookingId_expiresAt_idx" ON "BookingManageSession"("bookingId", "expiresAt");

ALTER TABLE "IntegrationOutbox" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "leaseExpiresAt" DATETIME;
CREATE INDEX "IntegrationOutbox_leaseExpiresAt_idx" ON "IntegrationOutbox"("leaseExpiresAt");

ALTER TABLE "OAuthConnection" ADD COLUMN "disconnectStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "OAuthConnection" ADD COLUMN "disconnectRetryAt" DATETIME;
ALTER TABLE "OAuthConnection" ADD COLUMN "disconnectErrorCode" TEXT;
ALTER TABLE "OAuthState" ADD COLUMN "nonce" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OAuthState" ADD COLUMN "processingToken" TEXT;
ALTER TABLE "OAuthState" ADD COLUMN "processingExpiresAt" DATETIME;
ALTER TABLE "EventDuration" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Booking" ADD COLUMN "cancellationReason" TEXT;

-- R91-era prototypes did not guarantee ciphertext in these legacy columns. Upgrade is deliberately reconnect-required.
UPDATE "OAuthConnection" SET "accessToken" = NULL, "refreshToken" = NULL, "disconnectStatus" = 'RECONNECT_REQUIRED';
