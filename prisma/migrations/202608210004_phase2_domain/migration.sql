PRAGMA foreign_keys=OFF;

-- Phase 2 is an explicit fresh-demo migration. Existing Phase-1 tenant data requires a separately reviewed export/reimport.
CREATE TEMP TABLE "_TempoCovePhase2FreshOnly" ("ok" INTEGER NOT NULL CHECK ("ok" = 1));
INSERT INTO "_TempoCovePhase2FreshOnly" ("ok")
SELECT CASE WHEN (SELECT COUNT(*) FROM "User") = 0 AND (SELECT COUNT(*) FROM "EventType") = 0 AND (SELECT COUNT(*) FROM "Booking") = 0 THEN 1 ELSE 0 END;
DROP TABLE "_TempoCovePhase2FreshOnly";

ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OAuthState" ADD COLUMN "authSessionId" TEXT REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "OAuthState_authSessionId_expiresAt_idx" ON "OAuthState"("authSessionId","expiresAt");

CREATE TABLE "EventDuration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventTypeId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventDuration_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EventDuration_eventTypeId_position_idx" ON "EventDuration"("eventTypeId", "position");
CREATE UNIQUE INDEX "EventDuration_one_default_per_event" ON "EventDuration"("eventTypeId") WHERE "isDefault" = 1;

CREATE TABLE "CustomQuestion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventTypeId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'TEXT',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "optionsJson" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CustomQuestion_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomQuestion_eventTypeId_position_idx" ON "CustomQuestion"("eventTypeId", "position");

CREATE TABLE "AvailabilityOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT false,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  CONSTRAINT "AvailabilityOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AvailabilityOverride_userId_dateKey_idx" ON "AvailabilityOverride"("userId", "dateKey");

CREATE TABLE "WorkspaceBranding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "workspaceName" TEXT NOT NULL,
  "logoUrl" TEXT,
  "accentColor" TEXT NOT NULL DEFAULT '#6D5EF5',
  "description" TEXT,
  "footerText" TEXT,
  CONSTRAINT "WorkspaceBranding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkspaceBranding_userId_key" ON "WorkspaceBranding"("userId");

CREATE TABLE "new_Booking" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventTypeId" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "durationId" TEXT,
  "durationMinutes" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
  "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
  "inviteeName" TEXT NOT NULL,
  "inviteeEmail" TEXT NOT NULL,
  "inviteeTimeZone" TEXT NOT NULL,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "notes" TEXT,
  "calendarSyncStatus" TEXT NOT NULL DEFAULT 'LOCAL',
  "externalCalendarEventId" TEXT,
  "stripeCheckoutSessionId" TEXT,
  "stripeCheckoutUrl" TEXT,
  "stripePaymentStatus" TEXT,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  "capabilityVersion" TEXT NOT NULL DEFAULT '',
  "manageExpiresAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Booking_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Booking_durationId_fkey" FOREIGN KEY ("durationId") REFERENCES "EventDuration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("id","eventTypeId","hostId","durationMinutes","priceCents","currency","bufferBeforeMinutes","bufferAfterMinutes","inviteeName","inviteeEmail","inviteeTimeZone","startAt","endAt","status","notes","calendarSyncStatus","externalCalendarEventId","stripeCheckoutSessionId","stripeCheckoutUrl","stripePaymentStatus","idempotencyKey","requestFingerprint","createdAt","updatedAt")
SELECT b."id",b."eventTypeId",b."hostId",e."durationMinutes",e."priceCents",e."currency",e."bufferBeforeMinutes",e."bufferAfterMinutes",b."inviteeName",b."inviteeEmail",b."inviteeTimeZone",b."startAt",b."endAt",b."status",b."notes",b."calendarSyncStatus",b."externalCalendarEventId",b."stripeCheckoutSessionId",b."stripeCheckoutUrl",b."stripePaymentStatus",b."idempotencyKey",b."requestFingerprint",b."createdAt",b."updatedAt"
FROM "Booking" b JOIN "EventType" e ON e."id"=b."eventTypeId";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_stripeCheckoutSessionId_key" ON "Booking"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");
CREATE INDEX "Booking_hostId_startAt_endAt_idx" ON "Booking"("hostId", "startAt", "endAt");
CREATE INDEX "Booking_eventTypeId_startAt_idx" ON "Booking"("eventTypeId", "startAt");

CREATE TABLE "BookingAnswer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "questionId" TEXT,
  "questionLabel" TEXT NOT NULL,
  "valueJson" TEXT NOT NULL,
  CONSTRAINT "BookingAnswer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BookingAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CustomQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "BookingAnswer_bookingId_idx" ON "BookingAnswer"("bookingId");

CREATE TABLE "BookingOccupancy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "minuteStart" DATETIME NOT NULL,
  CONSTRAINT "BookingOccupancy_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BookingOccupancy_hostId_minuteStart_key" ON "BookingOccupancy"("hostId","minuteStart");
CREATE INDEX "BookingOccupancy_bookingId_idx" ON "BookingOccupancy"("bookingId");

CREATE TABLE "BookingCapability" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingCapability_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BookingCapability_tokenHash_key" ON "BookingCapability"("tokenHash");
CREATE INDEX "BookingCapability_bookingId_scope_expiresAt_idx" ON "BookingCapability"("bookingId","scope","expiresAt");

CREATE TABLE "IntegrationOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "IntegrationOutbox_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntegrationOutbox_idempotencyKey_key" ON "IntegrationOutbox"("idempotencyKey");
CREATE INDEX "IntegrationOutbox_status_nextAttemptAt_idx" ON "IntegrationOutbox"("status","nextAttemptAt");

PRAGMA foreign_keys=ON;
