-- A booking's host is the immutable authority snapshotted from its EventType owner.
-- Abort upgrades before any durable DDL so remediation and retry remain clean.
DROP TABLE IF EXISTS temp."__booking_host_authority_preflight";
CREATE TEMP TABLE "__booking_host_authority_preflight" ("valid" INTEGER NOT NULL CHECK ("valid"=1));
INSERT INTO "__booking_host_authority_preflight" ("valid")
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM "Booking" b LEFT JOIN "EventType" e ON e."id"=b."eventTypeId"
  WHERE e."id" IS NULL OR e."workspaceId"<>b."workspaceId" OR e."ownerId"<>b."hostId"
) THEN 0 ELSE 1 END;
DROP TABLE temp."__booking_host_authority_preflight";

ALTER TABLE "Booking" ADD COLUMN "stripePaymentIntentId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "stripeChargeId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "stripeRefundId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "refundStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "Booking" ADD COLUMN "refundedAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "refundFailureCode" TEXT;
ALTER TABLE "Booking" ADD COLUMN "capabilityKeyId" TEXT NOT NULL DEFAULT 'legacy-auth-v1';
ALTER TABLE "Booking" ADD COLUMN "checkoutResumeExpiresAt" DATETIME;
UPDATE "Booking" SET "checkoutResumeExpiresAt"=datetime("createdAt", '+24 hours') WHERE "priceCents">0 AND "status"='PENDING_PAYMENT' AND "checkoutResumeExpiresAt" IS NULL;

DROP TRIGGER IF EXISTS "Booking_workspace_guard_insert";
DROP TRIGGER IF EXISTS "Booking_workspace_guard_update";
CREATE TRIGGER "Booking_workspace_guard_insert" BEFORE INSERT ON "Booking" FOR EACH ROW
WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=e."ownerId" AND m."status"='ACTIVE'
  WHERE e."id"=NEW."eventTypeId" AND e."workspaceId"=NEW."workspaceId" AND e."ownerId"=NEW."hostId")
BEGIN SELECT RAISE(ABORT,'booking host must equal event owner'); END;
CREATE TRIGGER "Booking_workspace_guard_update" BEFORE UPDATE OF "workspaceId","eventTypeId","hostId" ON "Booking" FOR EACH ROW
WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=e."ownerId" AND m."status"='ACTIVE'
  WHERE e."id"=NEW."eventTypeId" AND e."workspaceId"=NEW."workspaceId" AND e."ownerId"=NEW."hostId")
BEGIN SELECT RAISE(ABORT,'booking host must equal event owner'); END;

CREATE TRIGGER "EventType_booked_owner_immutable" BEFORE UPDATE OF "ownerId" ON "EventType" FOR EACH ROW
WHEN NEW."ownerId"<>OLD."ownerId" AND EXISTS (SELECT 1 FROM "Booking" b WHERE b."eventTypeId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'booked event owner cannot be transferred'); END;

CREATE UNIQUE INDEX "Booking_stripePaymentIntentId_key" ON "Booking"("stripePaymentIntentId");
CREATE UNIQUE INDEX "Booking_stripeChargeId_key" ON "Booking"("stripeChargeId");
CREATE UNIQUE INDEX "Booking_stripeRefundId_key" ON "Booking"("stripeRefundId");

UPDATE "Booking"
SET "refundStatus"='REFUND_FAILED', "refundFailureCode"='LEGACY_PAYMENT_AUTHORITY_REQUIRES_RECONCILIATION'
WHERE "status"='CANCELLED' AND "stripePaymentStatus" IN ('paid','paid_after_cancel');

INSERT OR IGNORE INTO "IntegrationOutbox" (
  "id","workspaceId","bookingId","kind","status","idempotencyKey","attemptCount","nextAttemptAt","lastErrorCode","createdAt","updatedAt"
)
SELECT 'refund_' || lower(hex(randomblob(16))), b."workspaceId", b."id", 'STRIPE_REFUND', 'DEAD',
       'stripe:refund:' || b."id" || ':full:v1', 8, CURRENT_TIMESTAMP,
       'LEGACY_PAYMENT_AUTHORITY_REQUIRES_RECONCILIATION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Booking" b
WHERE b."refundStatus"='REFUND_FAILED';

CREATE TRIGGER "Booking_refund_authority_guard_insert" BEFORE INSERT ON "Booking" FOR EACH ROW
WHEN NEW."refundStatus" NOT IN ('NOT_REQUIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')
  OR NEW."refundedAmountCents"<0 OR NEW."refundedAmountCents">NEW."priceCents"
  OR (NEW."refundStatus"='REFUNDED' AND (NEW."stripePaymentIntentId" IS NULL OR NEW."stripeRefundId" IS NULL OR NEW."refundedAmountCents"<>NEW."priceCents"))
  OR (NEW."refundStatus"='REFUND_PENDING' AND NEW."stripePaymentIntentId" IS NULL)
BEGIN SELECT RAISE(ABORT,'booking refund authority mismatch'); END;
CREATE TRIGGER "Booking_refund_authority_guard_update" BEFORE UPDATE OF "refundStatus","refundedAmountCents","stripePaymentIntentId","stripeRefundId","priceCents" ON "Booking" FOR EACH ROW
WHEN NEW."refundStatus" NOT IN ('NOT_REQUIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')
  OR NEW."refundedAmountCents"<0 OR NEW."refundedAmountCents">NEW."priceCents"
  OR (NEW."refundStatus"='REFUNDED' AND (NEW."stripePaymentIntentId" IS NULL OR NEW."stripeRefundId" IS NULL OR NEW."refundedAmountCents"<>NEW."priceCents"))
  OR (NEW."refundStatus"='REFUND_PENDING' AND NEW."stripePaymentIntentId" IS NULL)
BEGIN SELECT RAISE(ABORT,'booking refund authority mismatch'); END;
