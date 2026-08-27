ALTER TABLE "Booking" ADD COLUMN "eventTitleSnapshot" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN "locationTypeSnapshot" TEXT NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "Booking" ADD COLUMN "locationValueSnapshot" TEXT;
ALTER TABLE "Booking" ADD COLUMN "calendarProviderSnapshot" TEXT NOT NULL DEFAULT 'local';

UPDATE "Booking"
SET "eventTitleSnapshot" = COALESCE((SELECT "name" FROM "EventType" WHERE "EventType"."id" = "Booking"."eventTypeId"), ''),
    "locationTypeSnapshot" = COALESCE((SELECT "locationType" FROM "EventType" WHERE "EventType"."id" = "Booking"."eventTypeId"), 'CUSTOM'),
    "locationValueSnapshot" = (SELECT "locationValue" FROM "EventType" WHERE "EventType"."id" = "Booking"."eventTypeId");
