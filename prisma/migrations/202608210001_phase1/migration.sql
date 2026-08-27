PRAGMA foreign_keys=OFF;

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT,
  "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "EventType" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "durationMinutes" INTEGER NOT NULL DEFAULT 30,
  "color" TEXT NOT NULL DEFAULT '#6D5EF5',
  "locationType" TEXT NOT NULL DEFAULT 'GOOGLE_MEET',
  "locationValue" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
  "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
  "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
  "bookingWindowDays" INTEGER NOT NULL DEFAULT 60,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "EventType_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventType_slug_key" ON "EventType"("slug");
CREATE INDEX "EventType_ownerId_isActive_idx" ON "EventType"("ownerId", "isActive");

CREATE TABLE "AvailabilitySchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AvailabilitySchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AvailabilitySchedule_userId_key" ON "AvailabilitySchedule"("userId");

CREATE TABLE "AvailabilityInterval" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scheduleId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  CONSTRAINT "AvailabilityInterval_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AvailabilitySchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AvailabilityInterval_scheduleId_dayOfWeek_idx" ON "AvailabilityInterval"("scheduleId", "dayOfWeek");

CREATE TABLE "Booking" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventTypeId" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "inviteeName" TEXT NOT NULL,
  "inviteeEmail" TEXT NOT NULL,
  "inviteeTimeZone" TEXT NOT NULL,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "notes" TEXT,
  "cancelToken" TEXT NOT NULL,
  "calendarSyncStatus" TEXT NOT NULL DEFAULT 'LOCAL',
  "externalCalendarEventId" TEXT,
  "stripeCheckoutSessionId" TEXT,
  "stripePaymentStatus" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Booking_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "Booking"("cancelToken");
CREATE UNIQUE INDEX "Booking_stripeCheckoutSessionId_key" ON "Booking"("stripeCheckoutSessionId");
CREATE INDEX "Booking_hostId_startAt_endAt_idx" ON "Booking"("hostId", "startAt", "endAt");
CREATE INDEX "Booking_eventTypeId_startAt_idx" ON "Booking"("eventTypeId", "startAt");

CREATE TABLE "OAuthConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "expiresAt" DATETIME,
  "scope" TEXT,
  "calendarId" TEXT NOT NULL DEFAULT 'primary',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OAuthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OAuthConnection_userId_provider_key" ON "OAuthConnection"("userId", "provider");

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WebhookEvent_provider_id_key" ON "WebhookEvent"("provider", "id");

PRAGMA foreign_keys=ON;
