ALTER TABLE "Booking" ADD COLUMN "calendarLeaseToken" TEXT;
ALTER TABLE "Booking" ADD COLUMN "calendarLeaseExpiresAt" DATETIME;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "bookingMutationVersion" INTEGER;
