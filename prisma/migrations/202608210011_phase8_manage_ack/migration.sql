ALTER TABLE "Booking" ADD COLUMN "bookingWindowDays" INTEGER NOT NULL DEFAULT 60;
UPDATE "Booking"
SET "bookingWindowDays" = COALESCE((SELECT "bookingWindowDays" FROM "EventType" WHERE "EventType"."id" = "Booking"."eventTypeId"), 60);

ALTER TABLE "BookingManageSession" ADD COLUMN "acknowledgedAt" DATETIME;
