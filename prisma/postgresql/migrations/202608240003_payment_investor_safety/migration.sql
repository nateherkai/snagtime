DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Booking" b LEFT JOIN "EventType" e ON e.id=b."eventTypeId"
    WHERE e.id IS NULL OR e."workspaceId"<>b."workspaceId" OR e."ownerId"<>b."hostId"
  ) THEN RAISE EXCEPTION 'booking host authority preflight failed' USING ERRCODE='23514'; END IF;
END $preflight$;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripeChargeId" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "refundStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "refundedAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "refundFailureCode" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "capabilityKeyId" TEXT NOT NULL DEFAULT 'legacy-auth-v1';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "checkoutResumeExpiresAt" TIMESTAMP(3);
UPDATE "Booking" SET "checkoutResumeExpiresAt"="createdAt" + interval '24 hours' WHERE "priceCents">0 AND status='PENDING_PAYMENT' AND "checkoutResumeExpiresAt" IS NULL;

CREATE OR REPLACE FUNCTION tempocove_guard_booking_workspace() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=e."ownerId" AND m.status='ACTIVE'
    WHERE e.id=NEW."eventTypeId" AND e."workspaceId"=NEW."workspaceId" AND e."ownerId"=NEW."hostId"
  ) THEN RAISE EXCEPTION 'booking host must equal event owner' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION tempocove_guard_booked_event_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW."ownerId"<>OLD."ownerId" AND EXISTS (SELECT 1 FROM "Booking" b WHERE b."eventTypeId"=OLD.id) THEN
    RAISE EXCEPTION 'booked event owner cannot be transferred' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS event_booked_owner_immutable ON "EventType";
CREATE TRIGGER event_booked_owner_immutable BEFORE UPDATE OF "ownerId" ON "EventType" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_booked_event_owner();

CREATE OR REPLACE FUNCTION tempocove_public_booking_claim(row_booking text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_context_valid('public') AND position('|' in current_setting('tempocove.subject',true))>0 AND EXISTS(SELECT 1 FROM "Booking" b JOIN "EventType" e ON e.id=b."eventTypeId"
    WHERE b.id=row_booking AND b."workspaceId"=current_setting('tempocove.workspace_id',true) AND b."eventTypeId"=split_part(current_setting('tempocove.subject',true),'|',1)
      AND b."idempotencyKey"=split_part(current_setting('tempocove.subject',true),'|',2) AND e."workspaceId"=b."workspaceId" AND e."ownerId"=b."hostId")
$fn$;
DROP POLICY IF EXISTS app_public_booking_claim ON "Booking";
CREATE POLICY app_public_booking_claim ON "Booking" FOR INSERT TO tempocove_app WITH CHECK (
  tempocove_context_valid('public') AND position('|' in current_setting('tempocove.subject',true))>0 AND "workspaceId"=current_setting('tempocove.workspace_id',true)
  AND current_setting('tempocove.action',true)='booking_create' AND "eventTypeId"=split_part(current_setting('tempocove.subject',true),'|',1) AND "idempotencyKey"=split_part(current_setting('tempocove.subject',true),'|',2)
  AND EXISTS(SELECT 1 FROM "EventType" e WHERE e.id="eventTypeId" AND e."workspaceId"="Booking"."workspaceId" AND e."ownerId"="Booking"."hostId"));

CREATE OR REPLACE FUNCTION tempocove_link_checkout(p_booking text,p_session text,p_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE affected integer;
BEGIN
  IF NOT tempocove_context_valid('public') OR current_setting('tempocove.action',true)<>'booking_create'
     OR p_booking='' OR p_session='' OR p_url !~ '^https://' OR NOT tempocove_public_booking_claim(p_booking) THEN RETURN false; END IF;
  UPDATE "Booking" SET "stripeCheckoutSessionId"=p_session,"stripeCheckoutUrl"=p_url,"stripePaymentStatus"='unpaid',"updatedAt"=clock_timestamp()
    WHERE id=p_booking AND status='PENDING_PAYMENT' AND "stripeCheckoutSessionId" IS NULL AND "checkoutResumeExpiresAt">clock_timestamp() + interval '30 minutes';
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END $fn$;

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_stripePaymentIntentId_key" ON "Booking"("stripePaymentIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_stripeChargeId_key" ON "Booking"("stripeChargeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_stripeRefundId_key" ON "Booking"("stripeRefundId");

UPDATE "Booking"
SET "refundStatus"='REFUND_FAILED', "refundFailureCode"='LEGACY_PAYMENT_AUTHORITY_REQUIRES_RECONCILIATION'
WHERE "status"='CANCELLED' AND "stripePaymentStatus" IN ('paid','paid_after_cancel');

INSERT INTO "IntegrationOutbox" (
  "id","workspaceId","bookingId","kind","status","idempotencyKey","attemptCount","nextAttemptAt","lastErrorCode","createdAt","updatedAt"
)
SELECT 'refund_' || md5(b.id || clock_timestamp()::text || random()::text), b."workspaceId", b.id, 'STRIPE_REFUND', 'DEAD',
       'stripe:refund:' || b.id || ':full:v1', 8, clock_timestamp(),
       'LEGACY_PAYMENT_AUTHORITY_REQUIRES_RECONCILIATION', clock_timestamp(), clock_timestamp()
FROM "Booking" b
WHERE b."refundStatus"='REFUND_FAILED'
ON CONFLICT ("idempotencyKey") DO NOTHING;

CREATE OR REPLACE FUNCTION tempocove_guard_refund_authority() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW."refundStatus" NOT IN ('NOT_REQUIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')
    OR NEW."refundedAmountCents"<0 OR NEW."refundedAmountCents">NEW."priceCents"
    OR (NEW."refundStatus"='REFUNDED' AND (NEW."stripePaymentIntentId" IS NULL OR NEW."stripeRefundId" IS NULL OR NEW."refundedAmountCents"<>NEW."priceCents"))
    OR (NEW."refundStatus"='REFUND_PENDING' AND NEW."stripePaymentIntentId" IS NULL)
  THEN RAISE EXCEPTION 'booking refund authority mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS booking_refund_authority_guard ON "Booking";
CREATE TRIGGER booking_refund_authority_guard BEFORE INSERT OR UPDATE OF "refundStatus","refundedAmountCents","stripePaymentIntentId","stripeRefundId","priceCents" ON "Booking" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_refund_authority();

GRANT UPDATE("stripeRefundId","refundStatus","refundedAmountCents","refundFailureCode","updatedAt") ON "Booking" TO tempocove_worker;
