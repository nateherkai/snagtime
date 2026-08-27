ALTER TABLE "Booking" ADD COLUMN "stripeCheckoutUrl" TEXT;
DROP INDEX "Booking_active_host_start_key";
CREATE UNIQUE INDEX "Booking_active_host_start_key" ON "Booking"("hostId", "startAt") WHERE "status" IN ('CONFIRMED', 'PENDING_PAYMENT');
