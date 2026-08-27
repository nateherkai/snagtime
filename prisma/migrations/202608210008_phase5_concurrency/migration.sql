ALTER TABLE "Booking" ADD COLUMN "mutationVersion" INTEGER NOT NULL DEFAULT 0;

-- OAuth challenges are short-lived and prior rows stored PKCE material without the Phase-5 envelope.
DELETE FROM "OAuthState";
