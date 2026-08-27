UPDATE "Booking"
SET "calendarProviderSnapshot" = 'provider_recovery_required'
WHERE "externalCalendarEventId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "IntegrationOutbox"
    WHERE "IntegrationOutbox"."bookingId" = "Booking"."id"
      AND "kind" = 'CALENDAR_CREATE'
      AND "status" IN ('PENDING', 'RETRY', 'PROCESSING')
  );
