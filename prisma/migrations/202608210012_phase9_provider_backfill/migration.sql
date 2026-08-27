UPDATE "Booking"
SET "calendarProviderSnapshot" = 'google'
WHERE "externalCalendarEventId" IS NOT NULL;

ALTER TABLE "Booking" ADD COLUMN "externalCalendarEventEtag" TEXT;

UPDATE "BookingManageSession"
SET "acknowledgedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "acknowledgedAt" IS NULL
  AND 3 = (SELECT COUNT(DISTINCT "scope") FROM "BookingCapability" WHERE "BookingCapability"."bookingId" = "BookingManageSession"."bookingId" AND "revokedAt" IS NOT NULL)
  AND 0 = (SELECT COUNT(*) FROM "BookingCapability" WHERE "BookingCapability"."bookingId" = "BookingManageSession"."bookingId" AND "revokedAt" IS NULL);
