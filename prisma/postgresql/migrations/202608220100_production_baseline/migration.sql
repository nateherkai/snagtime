-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "councilForgeUserId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "councilForgeCompanyId" TEXT,
    "councilForgeEdgeId" TEXT,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouncilForgeSsoReplay" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouncilForgeSsoReplay_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "tokenHash" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDuration" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventDuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomQuestion" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "optionsJson" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CustomQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilitySchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilitySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityInterval" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "AvailabilityInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityOverride" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,

    CONSTRAINT "AvailabilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceBranding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#6D5EF5',
    "description" TEXT,
    "footerText" TEXT,

    CONSTRAINT "WorkspaceBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "durationId" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "bookingWindowDays" INTEGER NOT NULL DEFAULT 60,
    "inviteeName" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "inviteeTimeZone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "calendarSyncStatus" TEXT NOT NULL DEFAULT 'LOCAL',
    "externalCalendarEventId" TEXT,
    "externalCalendarEventEtag" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeCheckoutUrl" TEXT,
    "checkoutResumeExpiresAt" TIMESTAMP(3),
    "stripePaymentStatus" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeRefundId" TEXT,
    "refundStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundFailureCode" TEXT,
    "cancellationReason" TEXT,
    "eventTitleSnapshot" TEXT NOT NULL DEFAULT '',
    "locationTypeSnapshot" TEXT NOT NULL DEFAULT 'CUSTOM',
    "locationValueSnapshot" TEXT,
    "calendarProviderSnapshot" TEXT NOT NULL DEFAULT 'local',
    "notificationStatus" TEXT NOT NULL DEFAULT 'LOCAL_NO_EMAIL',
    "mutationVersion" INTEGER NOT NULL DEFAULT 0,
    "calendarLeaseToken" TEXT,
    "calendarLeaseExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "capabilityVersion" TEXT NOT NULL DEFAULT '',
    "capabilityKeyId" TEXT NOT NULL DEFAULT 'legacy-auth-v1',
    "manageExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAnswer" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "questionId" TEXT,
    "questionLabel" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,

    CONSTRAINT "BookingAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingOccupancy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "minuteStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingOccupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCapability" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingManageSession" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "BookingManageSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOutbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "bookingMutationVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountActionToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRecoveryToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookingId" TEXT,
    "kind" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subjectSnapshot" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "bookingMutationVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalInboxMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "encryptedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalInboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeWorkspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authSessionId" TEXT,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "processingToken" TEXT,
    "processingExpiresAt" TIMESTAMP(3),
    "expectedConnectionId" TEXT,
    "expectedConnectionGeneration" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "disconnectStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disconnectRetryAt" TIMESTAMP(3),
    "disconnectLeaseToken" TEXT,
    "disconnectLeaseExpiresAt" TIMESTAMP(3),
    "disconnectErrorCode" TEXT,
    "credentialGeneration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "buildId" TEXT NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_councilForgeUserId_key" ON "User"("councilForgeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_councilForgeCompanyId_key" ON "Workspace"("councilForgeCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_councilForgeEdgeId_key" ON "Workspace"("councilForgeEdgeId");

-- CreateIndex
CREATE INDEX "CouncilForgeSsoReplay_expiresAt_idx" ON "CouncilForgeSsoReplay"("expiresAt");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_workspaceId_key" ON "Membership"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_email_status_idx" ON "WorkspaceInvitation"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvitation_workspaceId_email_status_key" ON "WorkspaceInvitation"("workspaceId", "email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventType_slug_key" ON "EventType"("slug");

-- CreateIndex
CREATE INDEX "EventType_workspaceId_isActive_idx" ON "EventType"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "EventType_ownerId_isActive_idx" ON "EventType"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "EventDuration_eventTypeId_position_idx" ON "EventDuration"("eventTypeId", "position");

-- CreateIndex
CREATE INDEX "CustomQuestion_eventTypeId_position_idx" ON "CustomQuestion"("eventTypeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilitySchedule_workspaceId_userId_key" ON "AvailabilitySchedule"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "AvailabilityInterval_scheduleId_dayOfWeek_idx" ON "AvailabilityInterval"("scheduleId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "AvailabilityOverride_workspaceId_userId_dateKey_idx" ON "AvailabilityOverride"("workspaceId", "userId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceBranding_workspaceId_key" ON "WorkspaceBranding"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripeCheckoutSessionId_key" ON "Booking"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripePaymentIntentId_key" ON "Booking"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripeChargeId_key" ON "Booking"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripeRefundId_key" ON "Booking"("stripeRefundId");

-- CreateIndex
CREATE INDEX "Booking_workspaceId_startAt_endAt_idx" ON "Booking"("workspaceId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Booking_hostId_startAt_endAt_idx" ON "Booking"("hostId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Booking_eventTypeId_startAt_idx" ON "Booking"("eventTypeId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_workspaceId_eventTypeId_idempotencyKey_key" ON "Booking"("workspaceId", "eventTypeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BookingAnswer_bookingId_idx" ON "BookingAnswer"("bookingId");

-- CreateIndex
CREATE INDEX "BookingOccupancy_bookingId_idx" ON "BookingOccupancy"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingOccupancy_workspaceId_hostId_minuteStart_key" ON "BookingOccupancy"("workspaceId", "hostId", "minuteStart");

-- CreateIndex
CREATE UNIQUE INDEX "BookingCapability_tokenHash_key" ON "BookingCapability"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingCapability_bookingId_scope_expiresAt_idx" ON "BookingCapability"("bookingId", "scope", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingManageSession_tokenHash_key" ON "BookingManageSession"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingManageSession_bookingId_expiresAt_idx" ON "BookingManageSession"("bookingId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOutbox_idempotencyKey_key" ON "IntegrationOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_status_nextAttemptAt_idx" ON "IntegrationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_leaseExpiresAt_idx" ON "IntegrationOutbox"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountActionToken_tokenHash_key" ON "AccountActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountActionToken_userId_purpose_expiresAt_idx" ON "AccountActionToken"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "AccountActionToken_workspaceId_purpose_idx" ON "AccountActionToken"("workspaceId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRecoveryToken_tokenHash_key" ON "BookingRecoveryToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingRecoveryToken_bookingId_expiresAt_idx" ON "BookingRecoveryToken"("bookingId", "expiresAt");

-- CreateIndex
CREATE INDEX "BookingRecoveryToken_workspaceId_email_idx" ON "BookingRecoveryToken"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_idempotencyKey_key" ON "EmailOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_workspaceId_status_idx" ON "EmailOutbox"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "EmailOutbox_leaseExpiresAt_idx" ON "EmailOutbox"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalInboxMessage_outboxId_key" ON "LocalInboxMessage"("outboxId");

-- CreateIndex
CREATE INDEX "LocalInboxMessage_workspaceId_createdAt_idx" ON "LocalInboxMessage"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "OAuthState_userId_expiresAt_idx" ON "OAuthState"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "OAuthState_authSessionId_expiresAt_idx" ON "OAuthState"("authSessionId", "expiresAt");

-- CreateIndex
CREATE INDEX "OAuthState_expectedConnectionId_idx" ON "OAuthState"("expectedConnectionId");

-- CreateIndex
CREATE INDEX "OAuthConnection_userId_provider_idx" ON "OAuthConnection"("userId", "provider");

-- CreateIndex
CREATE INDEX "OAuthConnection_disconnectStatus_disconnectRetryAt_idx" ON "OAuthConnection"("disconnectStatus", "disconnectRetryAt");

-- CreateIndex
CREATE INDEX "OAuthConnection_disconnectStatus_disconnectLeaseExpiresAt_idx" ON "OAuthConnection"("disconnectStatus", "disconnectLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConnection_workspaceId_provider_key" ON "OAuthConnection"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_id_key" ON "WebhookEvent"("provider", "id");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowEnd_idx" ON "RateLimitBucket"("windowEnd");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventType" ADD CONSTRAINT "EventType_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventType" ADD CONSTRAINT "EventType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDuration" ADD CONSTRAINT "EventDuration_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomQuestion" ADD CONSTRAINT "CustomQuestion_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySchedule" ADD CONSTRAINT "AvailabilitySchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilitySchedule" ADD CONSTRAINT "AvailabilitySchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityInterval" ADD CONSTRAINT "AvailabilityInterval_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AvailabilitySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOverride" ADD CONSTRAINT "AvailabilityOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOverride" ADD CONSTRAINT "AvailabilityOverride_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceBranding" ADD CONSTRAINT "WorkspaceBranding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceBranding" ADD CONSTRAINT "WorkspaceBranding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_durationId_fkey" FOREIGN KEY ("durationId") REFERENCES "EventDuration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAnswer" ADD CONSTRAINT "BookingAnswer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAnswer" ADD CONSTRAINT "BookingAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CustomQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOccupancy" ADD CONSTRAINT "BookingOccupancy_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOccupancy" ADD CONSTRAINT "BookingOccupancy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCapability" ADD CONSTRAINT "BookingCapability_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingManageSession" ADD CONSTRAINT "BookingManageSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOutbox" ADD CONSTRAINT "IntegrationOutbox_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOutbox" ADD CONSTRAINT "IntegrationOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountActionToken" ADD CONSTRAINT "AccountActionToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountActionToken" ADD CONSTRAINT "AccountActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRecoveryToken" ADD CONSTRAINT "BookingRecoveryToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRecoveryToken" ADD CONSTRAINT "BookingRecoveryToken_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalInboxMessage" ADD CONSTRAINT "LocalInboxMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalInboxMessage" ADD CONSTRAINT "LocalInboxMessage_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "EmailOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_activeWorkspaceId_fkey" FOREIGN KEY ("activeWorkspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_membershipId_activeWorkspaceId_fkey" FOREIGN KEY ("membershipId", "activeWorkspaceId") REFERENCES "Membership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthConnection" ADD CONSTRAINT "OAuthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthConnection" ADD CONSTRAINT "OAuthConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PostgreSQL-only authority and least-privilege posture layered on the generated final schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_app') THEN CREATE ROLE tempocove_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_worker') THEN CREATE ROLE tempocove_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_monitor') THEN CREATE ROLE tempocove_monitor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_rls_verifier') THEN CREATE ROLE tempocove_rls_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_migration') THEN CREATE ROLE tempocove_migration NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_app_login') THEN CREATE ROLE tempocove_app_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_worker_login') THEN CREATE ROLE tempocove_worker_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_monitor_login') THEN CREATE ROLE tempocove_monitor_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tempocove_migration_login') THEN CREATE ROLE tempocove_migration_login NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS; END IF;
END $roles$;
GRANT tempocove_app TO tempocove_app_login;
GRANT tempocove_worker TO tempocove_worker_login;
GRANT tempocove_monitor TO tempocove_monitor_login;
GRANT tempocove_migration TO tempocove_migration_login;
REVOKE tempocove_worker,tempocove_monitor FROM tempocove_app_login;
REVOKE tempocove_app,tempocove_monitor FROM tempocove_worker_login;
REVOKE tempocove_app,tempocove_worker FROM tempocove_monitor_login;
GRANT USAGE ON SCHEMA public TO tempocove_app,tempocove_worker,tempocove_monitor,tempocove_rls_verifier,tempocove_migration;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tempocove_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO tempocove_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tempocove_worker,tempocove_monitor;
GRANT SELECT,INSERT ON "IntegrationOutbox","EmailOutbox" TO tempocove_worker;
GRANT UPDATE(status,"attemptCount","nextAttemptAt","lastErrorCode","leaseToken","leaseExpiresAt","updatedAt") ON "IntegrationOutbox" TO tempocove_worker;
GRANT UPDATE(status,"attemptCount","nextAttemptAt","lastErrorCode","leaseToken","leaseExpiresAt","completedAt","updatedAt") ON "EmailOutbox" TO tempocove_worker;
GRANT SELECT ON "Booking" TO tempocove_worker;
GRANT UPDATE("externalCalendarEventId","externalCalendarEventEtag","calendarLeaseToken","calendarLeaseExpiresAt","calendarSyncStatus","notificationStatus","stripeRefundId","refundStatus","refundedAmountCents","refundFailureCode","updatedAt") ON "Booking" TO tempocove_worker;
GRANT SELECT,DELETE ON "OAuthConnection" TO tempocove_worker;
GRANT UPDATE("accessToken","refreshToken","expiresAt","disconnectStatus","disconnectRetryAt","disconnectLeaseToken","disconnectLeaseExpiresAt","disconnectErrorCode","updatedAt") ON "OAuthConnection" TO tempocove_worker;
GRANT SELECT,INSERT ON "LocalInboxMessage" TO tempocove_worker;
GRANT SELECT,INSERT,UPDATE ON "WorkerHeartbeat" TO tempocove_worker;
GRANT SELECT ON "EventType","Workspace","Membership","BookingRecoveryToken","AccountActionToken","WorkspaceInvitation" TO tempocove_worker;
GRANT SELECT(id,email,name,"imageUrl","timeZone","emailVerifiedAt","createdAt","updatedAt") ON "User" TO tempocove_worker;

CREATE OR REPLACE FUNCTION tempocove_guard_booking_workspace() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=e."ownerId" AND m.status='ACTIVE'
    WHERE e.id=NEW."eventTypeId" AND e."workspaceId"=NEW."workspaceId" AND e."ownerId"=NEW."hostId") THEN
    RAISE EXCEPTION 'booking host must equal event owner' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER booking_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","eventTypeId","hostId" ON "Booking" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_booking_workspace();

CREATE OR REPLACE FUNCTION tempocove_guard_refund_authority() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW."refundStatus" NOT IN ('NOT_REQUIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')
    OR NEW."refundedAmountCents"<0 OR NEW."refundedAmountCents">NEW."priceCents"
    OR (NEW."refundStatus"='REFUNDED' AND (NEW."stripePaymentIntentId" IS NULL OR NEW."stripeRefundId" IS NULL OR NEW."refundedAmountCents"<>NEW."priceCents"))
    OR (NEW."refundStatus"='REFUND_PENDING' AND NEW."stripePaymentIntentId" IS NULL)
  THEN RAISE EXCEPTION 'booking refund authority mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER booking_refund_authority_guard BEFORE INSERT OR UPDATE OF "refundStatus","refundedAmountCents","stripePaymentIntentId","stripeRefundId","priceCents" ON "Booking" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_refund_authority();

CREATE OR REPLACE FUNCTION tempocove_guard_booking_child() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b.id=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId") THEN
    RAISE EXCEPTION 'booking child workspace mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER occupancy_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","bookingId" ON "BookingOccupancy" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_booking_child();
CREATE TRIGGER integration_outbox_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","bookingId" ON "IntegrationOutbox" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_booking_child();
CREATE TRIGGER booking_recovery_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","bookingId" ON "BookingRecoveryToken" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_booking_child();
CREATE OR REPLACE FUNCTION tempocove_guard_occupancy_host() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b.id=NEW."bookingId" AND b."hostId"=NEW."hostId") THEN RAISE EXCEPTION 'booking child host mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER occupancy_host_guard BEFORE INSERT OR UPDATE OF "bookingId","hostId" ON "BookingOccupancy" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_occupancy_host();

CREATE OR REPLACE FUNCTION tempocove_guard_optional_booking_child() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW."bookingId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b.id=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId") THEN
    RAISE EXCEPTION 'optional booking child workspace mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER email_outbox_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","bookingId" ON "EmailOutbox" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_optional_booking_child();

CREATE OR REPLACE FUNCTION tempocove_guard_auth_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m.id=NEW."membershipId" AND m."workspaceId"=NEW."activeWorkspaceId" AND m."userId"=NEW."userId" AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'auth session membership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER auth_session_workspace_guard BEFORE INSERT OR UPDATE OF "userId","activeWorkspaceId","membershipId" ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_auth_session();

CREATE OR REPLACE FUNCTION tempocove_guard_oauth_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN')) THEN
    RAISE EXCEPTION 'oauth connector requires live admin' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER oauth_admin_custody_guard BEFORE INSERT OR UPDATE ON "OAuthConnection" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_oauth_admin();

CREATE OR REPLACE FUNCTION tempocove_guard_last_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE remaining integer;
BEGIN
  IF OLD.role='OWNER' AND OLD.status='ACTIVE' AND (TG_OP='DELETE' OR NEW.role<>'OWNER' OR NEW.status<>'ACTIVE') AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w.id=OLD."workspaceId") THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD."workspaceId", 901));
    SELECT count(*) INTO remaining FROM "Membership" m WHERE m."workspaceId"=OLD."workspaceId" AND m.role='OWNER' AND m.status='ACTIVE' AND m.id<>OLD.id;
    IF remaining=0 THEN RAISE EXCEPTION 'workspace must retain an active owner' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $fn$;
CREATE TRIGGER membership_last_owner_guard BEFORE UPDATE OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_last_owner();

CREATE OR REPLACE FUNCTION tempocove_guard_email_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF ROW(NEW."workspaceId",NEW."bookingId",NEW.kind,NEW."recipientEmail",NEW."subjectSnapshot",NEW."payloadJson",NEW."bookingMutationVersion",NEW."idempotencyKey")
     IS DISTINCT FROM ROW(OLD."workspaceId",OLD."bookingId",OLD.kind,OLD."recipientEmail",OLD."subjectSnapshot",OLD."payloadJson",OLD."bookingMutationVersion",OLD."idempotencyKey") THEN
    RAISE EXCEPTION 'email outbox snapshot is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER email_outbox_snapshot_immutable BEFORE UPDATE ON "EmailOutbox" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_email_snapshot();

CREATE OR REPLACE FUNCTION tempocove_guard_invitation_acceptance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW.status='ACCEPTED' AND (NEW."acceptedById" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "User" u JOIN "Membership" m ON m."userId"=u.id AND m."workspaceId"=NEW."workspaceId" AND m.status='ACTIVE'
    WHERE u.id=NEW."acceptedById" AND lower(u.email)=lower(NEW.email))) THEN
    RAISE EXCEPTION 'invitation acceptance mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER invitation_acceptance_guard BEFORE UPDATE ON "WorkspaceInvitation" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_invitation_acceptance();

CREATE OR REPLACE FUNCTION tempocove_guard_event_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."ownerId" AND m.status='ACTIVE') THEN RAISE EXCEPTION 'event owner workspace mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER event_owner_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","ownerId" ON "EventType" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_event_owner();

CREATE OR REPLACE FUNCTION tempocove_guard_booked_event_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW."ownerId"<>OLD."ownerId" AND EXISTS (SELECT 1 FROM "Booking" b WHERE b."eventTypeId"=OLD.id) THEN RAISE EXCEPTION 'booked event owner cannot be transferred' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER event_booked_owner_immutable BEFORE UPDATE OF "ownerId" ON "EventType" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_booked_event_owner();

CREATE OR REPLACE FUNCTION tempocove_guard_member_owned() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m.status='ACTIVE') THEN RAISE EXCEPTION 'member-owned workspace mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER availability_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","userId" ON "AvailabilitySchedule" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_member_owned();
CREATE TRIGGER override_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","userId" ON "AvailabilityOverride" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_member_owned();
CREATE TRIGGER branding_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","userId" ON "WorkspaceBranding" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_member_owned();
CREATE TRIGGER account_action_workspace_guard BEFORE INSERT ON "AccountActionToken" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_member_owned();

CREATE OR REPLACE FUNCTION tempocove_guard_oauth_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NEW."authSessionId" IS NULL OR NOT EXISTS (SELECT 1 FROM "AuthSession" s WHERE s.id=NEW."authSessionId" AND s."activeWorkspaceId"=NEW."workspaceId" AND s."userId"=NEW."userId" AND s."revokedAt" IS NULL) THEN RAISE EXCEPTION 'oauth state workspace mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER oauth_state_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","userId","authSessionId" ON "OAuthState" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_oauth_state();

CREATE OR REPLACE FUNCTION tempocove_guard_inviter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."invitedById" AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN')) THEN RAISE EXCEPTION 'inviter workspace mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER invitation_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","invitedById" ON "WorkspaceInvitation" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_inviter();

CREATE OR REPLACE FUNCTION tempocove_guard_recovery_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF TG_TABLE_NAME='BookingRecoveryToken' AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b.id=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId" AND lower(b."inviteeEmail")=lower(NEW.email)) THEN RAISE EXCEPTION 'booking recovery identity mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW."workspaceId",NEW."bookingId",NEW.email,NEW."tokenHash") IS DISTINCT FROM ROW(OLD."workspaceId",OLD."bookingId",OLD.email,OLD."tokenHash") THEN RAISE EXCEPTION 'recovery identity immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER booking_recovery_workspace_guard ON "BookingRecoveryToken";
CREATE TRIGGER booking_recovery_identity_guard BEFORE INSERT OR UPDATE ON "BookingRecoveryToken" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_recovery_identity();

CREATE OR REPLACE FUNCTION tempocove_guard_account_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF ROW(NEW."workspaceId",NEW."userId",NEW.purpose,NEW.email,NEW."tokenHash") IS DISTINCT FROM ROW(OLD."workspaceId",OLD."userId",OLD.purpose,OLD.email,OLD."tokenHash") THEN RAISE EXCEPTION 'account authority identity immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER account_action_identity_immutable BEFORE UPDATE ON "AccountActionToken" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_account_identity();

CREATE OR REPLACE FUNCTION tempocove_guard_local_inbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EmailOutbox" o WHERE o.id=NEW."outboxId" AND o."workspaceId"=NEW."workspaceId") THEN RAISE EXCEPTION 'local inbox workspace mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER local_inbox_workspace_guard BEFORE INSERT OR UPDATE OF "workspaceId","outboxId" ON "LocalInboxMessage" FOR EACH ROW EXECUTE FUNCTION tempocove_guard_local_inbox();

ALTER FUNCTION tempocove_guard_booking_workspace() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_booking_child() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_occupancy_host() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_optional_booking_child() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_auth_session() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_oauth_admin() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_last_owner() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_email_snapshot() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_invitation_acceptance() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_event_owner() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_member_owned() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_oauth_state() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_inviter() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_recovery_identity() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_account_identity() OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_guard_local_inbox() OWNER TO tempocove_rls_verifier;

-- Application tenant authority is transaction local and authenticated with a server-held key.
-- The application login cannot read or mutate the key and direct SQL cannot manufacture a
-- usable context merely by setting custom GUCs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tempocove_context_authority (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  secret text NOT NULL CHECK (octet_length(secret) >= 32),
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE tempocove_schema_release (
  migration_name text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO tempocove_schema_release(migration_name) VALUES ('202608220100_production_baseline');
GRANT SELECT ON tempocove_schema_release TO tempocove_app,tempocove_monitor;
REVOKE ALL ON tempocove_context_authority FROM PUBLIC,tempocove_app,tempocove_worker,tempocove_monitor;

CREATE OR REPLACE FUNCTION tempocove_context_valid(required_mode text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $fn$
DECLARE
  mode_value text := current_setting('tempocove.mode',true);
  workspace_value text := current_setting('tempocove.workspace_id',true);
  user_value text := current_setting('tempocove.user_id',true);
  session_value text := current_setting('tempocove.session_hash',true);
  subject_value text := current_setting('tempocove.subject',true);
  action_value text := current_setting('tempocove.action',true);
  supplied_signature text := current_setting('tempocove.signature',true);
  authority_secret text;
  expected_signature text;
BEGIN
  IF mode_value IS NULL OR mode_value NOT IN ('auth','bootstrap','federated','session','workspace','public','capability','provider')
     OR supplied_signature IS NULL OR supplied_signature !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  IF required_mode IS NOT NULL AND mode_value <> required_mode THEN RETURN false; END IF;
  SELECT secret INTO authority_secret FROM tempocove_context_authority WHERE singleton;
  IF authority_secret IS NULL THEN RETURN false; END IF;
  expected_signature := encode(hmac(
    convert_to('v2','UTF8') || decode('00','hex') || convert_to(mode_value,'UTF8') || decode('00','hex') ||
    convert_to(coalesce(workspace_value,''),'UTF8') || decode('00','hex') || convert_to(coalesce(user_value,''),'UTF8') || decode('00','hex') ||
    convert_to(coalesce(session_value,''),'UTF8') || decode('00','hex') || convert_to(coalesce(subject_value,''),'UTF8') || decode('00','hex') || convert_to(coalesce(action_value,''),'UTF8'),
    convert_to(authority_secret,'UTF8'),'sha256'),'hex');
  IF supplied_signature IS DISTINCT FROM expected_signature THEN RETURN false; END IF;
  IF mode_value='session' AND workspace_value='' THEN
    RETURN user_value<>'' AND session_value<>'' AND EXISTS (
      SELECT 1 FROM "AuthSession" s JOIN "Membership" m ON m.id=s."membershipId"
      WHERE s."tokenHash"=session_value AND s."userId"=user_value AND s."revokedAt" IS NULL
        AND s."expiresAt">clock_timestamp() AND m.status='ACTIVE'
    );
  END IF;
  IF mode_value IN ('session','workspace') THEN
    RETURN workspace_value <> '' AND user_value <> '' AND EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."workspaceId"=workspace_value AND m."userId"=user_value AND m.status='ACTIVE'
    ) AND (session_value='' OR EXISTS (
      SELECT 1 FROM "AuthSession" s JOIN "Membership" m ON m.id=s."membershipId"
      WHERE s."tokenHash"=session_value AND s."activeWorkspaceId"=workspace_value AND s."userId"=user_value
        AND s."revokedAt" IS NULL AND s."expiresAt">clock_timestamp() AND m.status='ACTIVE'
    ));
  END IF;
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION tempocove_context_valid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_context_valid(text) TO tempocove_app;
GRANT SELECT ON tempocove_context_authority,"Workspace","Membership","AuthSession","User","WorkspaceInvitation","EventType","Booking","EmailOutbox","OAuthConnection" TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_context_valid(text) OWNER TO tempocove_rls_verifier;

CREATE OR REPLACE FUNCTION tempocove_live_member(row_workspace text,row_user text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=row_workspace AND m."userId"=row_user AND m.status='ACTIVE')
$fn$;
CREATE OR REPLACE FUNCTION tempocove_user_email_matches(row_user text,row_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (SELECT 1 FROM "User" u WHERE u.id=row_user AND lower(u.email)=lower(row_email))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_invitation_matches(invitation_id text,row_workspace text,row_user text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (SELECT 1 FROM "WorkspaceInvitation" i LEFT JOIN "User" u ON u.id=row_user
    WHERE i.id=invitation_id AND i."workspaceId"=row_workspace AND (row_user IS NULL OR row_user=i."invitedById" OR lower(u.email)=lower(i.email)))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_public_event_relation(event_subject text,row_workspace text DEFAULT NULL,row_owner text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (SELECT 1 FROM "EventType" e WHERE e."isActive"=true AND event_subject IN (e.id,e.slug)
    AND (row_workspace IS NULL OR e."workspaceId"=row_workspace) AND (row_owner IS NULL OR e."ownerId"=row_owner))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_booking_relation(booking_subject text,row_workspace text DEFAULT NULL,row_event text DEFAULT NULL,row_host text DEFAULT NULL,row_duration text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (SELECT 1 FROM "Booking" b WHERE b.id=booking_subject
    AND (row_workspace IS NULL OR b."workspaceId"=row_workspace) AND (row_event IS NULL OR b."eventTypeId"=row_event)
    AND (row_host IS NULL OR b."hostId"=row_host) AND (row_duration IS NULL OR b."durationId"=row_duration))
$fn$;
ALTER FUNCTION tempocove_live_member(text,text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_user_email_matches(text,text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_invitation_matches(text,text,text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_public_event_relation(text,text,text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_booking_relation(text,text,text,text,text) OWNER TO tempocove_rls_verifier;
REVOKE ALL ON FUNCTION tempocove_live_member(text,text),tempocove_user_email_matches(text,text),tempocove_invitation_matches(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tempocove_public_event_relation(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tempocove_booking_relation(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_live_member(text,text),tempocove_user_email_matches(text,text),tempocove_invitation_matches(text,text,text) TO tempocove_app;
GRANT EXECUTE ON FUNCTION tempocove_public_event_relation(text,text,text) TO tempocove_app;
GRANT EXECUTE ON FUNCTION tempocove_booking_relation(text,text,text,text,text) TO tempocove_app;

-- Public Calendar access is brokered through exact published-event context. The
-- app login never receives table privileges on Membership or OAuthConnection.
CREATE OR REPLACE FUNCTION tempocove_public_google_ready(p_event text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_context_valid('public')
    AND current_setting('tempocove.action',true) IN ('public_read','booking_create')
    AND split_part(current_setting('tempocove.subject',true),'|',1)=p_event
    AND EXISTS (
      SELECT 1 FROM "EventType" e
      JOIN "Membership" host_member ON host_member."workspaceId"=e."workspaceId" AND host_member."userId"=e."ownerId" AND host_member.status='ACTIVE'
      JOIN "OAuthConnection" connection ON connection."workspaceId"=e."workspaceId" AND connection.provider='google'
        AND connection."disconnectStatus"='ACTIVE' AND connection."refreshToken" IS NOT NULL AND octet_length(connection."refreshToken")>0
      JOIN "Membership" credential_member ON credential_member."workspaceId"=e."workspaceId" AND credential_member."userId"=connection."userId"
        AND credential_member.status='ACTIVE' AND credential_member.role IN ('OWNER','ADMIN')
      WHERE e.id=p_event AND e."isActive"=true AND e."workspaceId"=current_setting('tempocove.workspace_id',true)
    )
$fn$;
CREATE OR REPLACE FUNCTION tempocove_public_google_credential(p_event text)
RETURNS TABLE(connection_id text,workspace_id text,credential_user_id text,access_token text,refresh_token text,expires_at timestamp,calendar_id text,credential_generation integer,disconnect_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT connection.id,connection."workspaceId",connection."userId",connection."accessToken",connection."refreshToken",connection."expiresAt",connection."calendarId",connection."credentialGeneration",connection."disconnectStatus"
  FROM "EventType" e JOIN "OAuthConnection" connection ON connection."workspaceId"=e."workspaceId" AND connection.provider='google'
  WHERE e.id=p_event AND tempocove_public_google_ready(p_event) AND connection."disconnectStatus"='ACTIVE'
$fn$;
CREATE OR REPLACE FUNCTION tempocove_public_google_refresh(p_event text,p_connection text,p_generation integer,p_access text,p_refresh text,p_expires timestamp)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE affected integer;
BEGIN
  IF NOT tempocove_public_google_ready(p_event) THEN RETURN false; END IF;
  UPDATE "OAuthConnection" SET "accessToken"=coalesce(p_access,"accessToken"),"refreshToken"=coalesce(p_refresh,"refreshToken"),"expiresAt"=coalesce(p_expires,"expiresAt"),"updatedAt"=clock_timestamp()
  WHERE id=p_connection AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND provider='google'
    AND "disconnectStatus"='ACTIVE' AND "credentialGeneration"=p_generation;
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END $fn$;
ALTER FUNCTION tempocove_public_google_ready(text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_public_google_credential(text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_public_google_refresh(text,text,integer,text,text,timestamp) OWNER TO tempocove_rls_verifier;
REVOKE ALL ON FUNCTION tempocove_public_google_ready(text),tempocove_public_google_credential(text),tempocove_public_google_refresh(text,text,integer,text,text,timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_public_google_ready(text),tempocove_public_google_credential(text),tempocove_public_google_refresh(text,text,integer,text,text,timestamp) TO tempocove_app;

CREATE OR REPLACE FUNCTION tempocove_workspace_access(row_workspace text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_context_valid(NULL) AND current_setting('tempocove.mode',true) IN ('session','workspace')
    AND current_setting('tempocove.workspace_id',true)=row_workspace
    AND tempocove_live_member(row_workspace,current_setting('tempocove.user_id',true))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_workspace_admin(row_workspace text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_workspace_access(row_workspace) AND EXISTS(SELECT 1 FROM "Membership" m WHERE m."workspaceId"=row_workspace
    AND m."userId"=current_setting('tempocove.user_id',true) AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN'))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_workspace_owner(row_workspace text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_workspace_access(row_workspace) AND EXISTS(SELECT 1 FROM "Membership" m WHERE m."workspaceId"=row_workspace
    AND m."userId"=current_setting('tempocove.user_id',true) AND m.status='ACTIVE' AND m.role='OWNER')
$fn$;
CREATE OR REPLACE FUNCTION tempocove_workspace_actor(row_workspace text,row_user text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_workspace_access(row_workspace) AND (row_user=current_setting('tempocove.user_id',true) OR tempocove_workspace_admin(row_workspace))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_booking_actor(row_booking text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS(SELECT 1 FROM "Booking" b WHERE b.id=row_booking AND tempocove_workspace_actor(b."workspaceId",b."hostId"))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_booking_write_child(row_booking text,row_workspace text,row_email text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_context_valid(NULL) AND current_setting('tempocove.action',true)='booking_write' AND EXISTS(
    SELECT 1 FROM "Booking" b WHERE b.id=row_booking AND b."workspaceId"=row_workspace
      AND (row_email IS NULL OR lower(b."inviteeEmail")=lower(row_email)) AND tempocove_workspace_actor(b."workspaceId",b."hostId"))
$fn$;
ALTER FUNCTION tempocove_workspace_access(text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_workspace_admin(text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_workspace_owner(text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_workspace_actor(text,text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_booking_actor(text) OWNER TO tempocove_rls_verifier;
ALTER FUNCTION tempocove_booking_write_child(text,text,text) OWNER TO tempocove_rls_verifier;
REVOKE ALL ON FUNCTION tempocove_workspace_access(text),tempocove_workspace_admin(text),tempocove_workspace_owner(text),tempocove_workspace_actor(text,text),tempocove_booking_actor(text),tempocove_booking_write_child(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_workspace_access(text),tempocove_workspace_admin(text),tempocove_workspace_owner(text),tempocove_workspace_actor(text,text),tempocove_booking_actor(text),tempocove_booking_write_child(text,text,text) TO tempocove_app;

-- Direct workspace roots.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Workspace','Membership','WorkspaceInvitation','EventType','AvailabilitySchedule','AvailabilityOverride','WorkspaceBranding','Booking','BookingOccupancy','IntegrationOutbox','AccountActionToken','BookingRecoveryToken','EmailOutbox','LocalInboxMessage','AuthSession','OAuthState','OAuthConnection'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['Workspace','Membership','WorkspaceInvitation','EventType','AvailabilitySchedule','AvailabilityOverride','WorkspaceBranding','Booking','BookingOccupancy','IntegrationOutbox','EmailOutbox','LocalInboxMessage','OAuthConnection'] LOOP
    EXECUTE format('CREATE POLICY app_workspace_read ON %I FOR SELECT TO tempocove_app USING (tempocove_workspace_access(%I))',table_name,CASE WHEN table_name='Workspace' THEN 'id' ELSE 'workspaceId' END);
  END LOOP;
END $rls$;
CREATE POLICY app_workspace_update ON "Workspace" FOR UPDATE TO tempocove_app USING (tempocove_workspace_admin(id) AND current_setting('tempocove.action',true) IN ('workspace_update','branding_write')) WITH CHECK (tempocove_workspace_admin(id));
CREATE POLICY app_membership_update ON "Membership" FOR UPDATE TO tempocove_app USING (tempocove_workspace_owner("workspaceId") AND current_setting('tempocove.action',true)='membership_change') WITH CHECK (tempocove_workspace_owner("workspaceId") AND role IN ('OWNER','ADMIN','MEMBER'));
CREATE POLICY app_invitation_write ON "WorkspaceInvitation" FOR INSERT TO tempocove_app WITH CHECK (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='invitation_write' AND role IN ('ADMIN','MEMBER'));
CREATE POLICY app_invitation_update ON "WorkspaceInvitation" FOR UPDATE TO tempocove_app USING (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='invitation_write') WITH CHECK (tempocove_workspace_admin("workspaceId"));
CREATE POLICY app_event_write ON "EventType" FOR ALL TO tempocove_app USING (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='event_write') WITH CHECK (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='event_write');
CREATE POLICY app_branding_write ON "WorkspaceBranding" FOR ALL TO tempocove_app USING (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='branding_write') WITH CHECK (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='branding_write');
CREATE POLICY app_oauth_state_write ON "OAuthState" FOR ALL TO tempocove_app USING (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='oauth_write') WITH CHECK (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='oauth_write');
CREATE POLICY app_oauth_connection_write ON "OAuthConnection" FOR ALL TO tempocove_app USING (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='oauth_write') WITH CHECK (tempocove_workspace_admin("workspaceId") AND current_setting('tempocove.action',true)='oauth_write');
CREATE POLICY app_workspace_booking_write ON "Booking" FOR UPDATE TO tempocove_app USING (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write') WITH CHECK (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write');
CREATE POLICY app_workspace_occupancy_delete ON "BookingOccupancy" FOR DELETE TO tempocove_app USING (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write');
CREATE POLICY app_workspace_occupancy_insert ON "BookingOccupancy" FOR INSERT TO tempocove_app WITH CHECK (tempocove_workspace_actor("workspaceId","hostId") AND current_setting('tempocove.action',true)='booking_write');
CREATE POLICY app_workspace_booking_recovery_update ON "BookingRecoveryToken" FOR UPDATE TO tempocove_app USING (tempocove_booking_write_child("bookingId","workspaceId",email)) WITH CHECK (tempocove_booking_write_child("bookingId","workspaceId",email));
CREATE POLICY app_workspace_booking_recovery_insert ON "BookingRecoveryToken" FOR INSERT TO tempocove_app WITH CHECK (tempocove_booking_write_child("bookingId","workspaceId",email));
CREATE POLICY app_workspace_booking_recovery_read ON "BookingRecoveryToken" FOR SELECT TO tempocove_app USING (tempocove_booking_write_child("bookingId","workspaceId",email));
CREATE POLICY app_workspace_booking_email_insert ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND "bookingId" IS NOT NULL AND tempocove_booking_actor("bookingId") AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL AND EXISTS(SELECT 1 FROM "Booking" b JOIN "User" h ON h.id=b."hostId" WHERE b.id="bookingId" AND b."workspaceId"="EmailOutbox"."workspaceId" AND lower("recipientEmail") IN (lower(b."inviteeEmail"),lower(h.email)) AND ("bookingMutationVersion" IS NULL OR "bookingMutationVersion"=b."mutationVersion")));
CREATE POLICY app_workspace_booking_outbox_insert ON "IntegrationOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId") AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL AND EXISTS(SELECT 1 FROM "Booking" b WHERE b.id="bookingId" AND b."workspaceId"="IntegrationOutbox"."workspaceId"));
CREATE POLICY app_workspace_schedule_write ON "AvailabilitySchedule" FOR ALL TO tempocove_app USING (tempocove_workspace_actor("workspaceId","userId") AND current_setting('tempocove.action',true)='availability_write') WITH CHECK (tempocove_workspace_actor("workspaceId","userId") AND current_setting('tempocove.action',true)='availability_write');
CREATE POLICY app_workspace_override_write ON "AvailabilityOverride" FOR ALL TO tempocove_app USING (tempocove_workspace_actor("workspaceId","userId") AND current_setting('tempocove.action',true)='availability_write') WITH CHECK (tempocove_workspace_actor("workspaceId","userId") AND current_setting('tempocove.action',true)='availability_write');

-- Public slug resolution is the only workspace-less tenant read. Once resolved, the server
-- replaces it with a workspace-bound signed context before accessing children or bookings.
CREATE POLICY app_public_event ON "EventType" FOR SELECT TO tempocove_app
USING (tempocove_context_valid('public') AND "isActive"=true AND split_part(current_setting('tempocove.subject',true),'|',1) IN (id,slug));
CREATE POLICY app_public_workspace ON "Workspace" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND tempocove_public_event_relation(split_part(current_setting('tempocove.subject',true),'|',1),"Workspace".id,NULL)
);
CREATE POLICY app_public_duration ON "EventDuration" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND EXISTS (SELECT 1 FROM "EventType" e WHERE e."isActive"=true AND e.id="eventTypeId" AND split_part(current_setting('tempocove.subject',true),'|',1) IN (e.id,e.slug))
);
CREATE POLICY app_public_question ON "CustomQuestion" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND EXISTS (SELECT 1 FROM "EventType" e WHERE e."isActive"=true AND e.id="eventTypeId" AND split_part(current_setting('tempocove.subject',true),'|',1) IN (e.id,e.slug))
);
CREATE POLICY app_public_branding ON "WorkspaceBranding" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND EXISTS (SELECT 1 FROM "EventType" e WHERE e."isActive"=true AND e."workspaceId"="WorkspaceBranding"."workspaceId" AND split_part(current_setting('tempocove.subject',true),'|',1) IN (e.id,e.slug))
);
CREATE POLICY app_public_schedule ON "AvailabilitySchedule" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND EXISTS(SELECT 1 FROM "EventType" e WHERE e."isActive"=true AND e."workspaceId"="AvailabilitySchedule"."workspaceId" AND e."ownerId"="AvailabilitySchedule"."userId" AND split_part(current_setting('tempocove.subject',true),'|',1) IN (e.id,e.slug))
);
CREATE POLICY app_public_interval ON "AvailabilityInterval" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND EXISTS(SELECT 1 FROM "AvailabilitySchedule" s JOIN "EventType" e ON e."workspaceId"=s."workspaceId" AND e."ownerId"=s."userId" WHERE s.id="scheduleId" AND e."isActive"=true AND split_part(current_setting('tempocove.subject',true),'|',1) IN (e.id,e.slug))
);
CREATE POLICY app_public_override ON "AvailabilityOverride" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND EXISTS(SELECT 1 FROM "EventType" e WHERE e."isActive"=true AND e."workspaceId"="AvailabilityOverride"."workspaceId" AND e."ownerId"="AvailabilityOverride"."userId" AND split_part(current_setting('tempocove.subject',true),'|',1) IN (e.id,e.slug))
);
CREATE OR REPLACE FUNCTION tempocove_public_booking_claim(row_booking text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_context_valid('public') AND position('|' in current_setting('tempocove.subject',true))>0 AND EXISTS(SELECT 1 FROM "Booking" b JOIN "EventType" e ON e.id=b."eventTypeId"
    WHERE b.id=row_booking AND b."workspaceId"=current_setting('tempocove.workspace_id',true) AND b."eventTypeId"=split_part(current_setting('tempocove.subject',true),'|',1)
      AND b."idempotencyKey"=split_part(current_setting('tempocove.subject',true),'|',2) AND e."workspaceId"=b."workspaceId" AND e."ownerId"=b."hostId")
$fn$;
ALTER FUNCTION tempocove_public_booking_claim(text) OWNER TO tempocove_rls_verifier;
REVOKE ALL ON FUNCTION tempocove_public_booking_claim(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION tempocove_public_booking_claim(text) TO tempocove_app;
CREATE POLICY app_public_booking_read ON "Booking" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('public') AND "workspaceId"=current_setting('tempocove.workspace_id',true)
  AND "eventTypeId"=split_part(current_setting('tempocove.subject',true),'|',1) AND "idempotencyKey"=split_part(current_setting('tempocove.subject',true),'|',2));
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
ALTER FUNCTION tempocove_link_checkout(text,text,text) OWNER TO tempocove_rls_verifier;
REVOKE ALL ON FUNCTION tempocove_link_checkout(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_link_checkout(text,text,text) TO tempocove_app;
CREATE POLICY app_public_occupancy_claim ON "BookingOccupancy" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_create' AND tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_occupancy_read ON "BookingOccupancy" FOR SELECT TO tempocove_app USING (tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_outbox_claim ON "IntegrationOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_create' AND tempocove_public_booking_claim("bookingId") AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL);
CREATE POLICY app_public_outbox_read ON "IntegrationOutbox" FOR SELECT TO tempocove_app USING (tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_email_claim ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_create' AND "bookingId" IS NOT NULL AND tempocove_public_booking_claim("bookingId") AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL AND EXISTS(SELECT 1 FROM "Booking" b JOIN "User" h ON h.id=b."hostId" WHERE b.id="bookingId" AND lower("recipientEmail") IN (lower(b."inviteeEmail"),lower(h.email)) AND ("bookingMutationVersion" IS NULL OR "bookingMutationVersion"=b."mutationVersion")));
CREATE POLICY app_public_email_read ON "EmailOutbox" FOR SELECT TO tempocove_app USING ("bookingId" IS NOT NULL AND tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_recovery_insert ON "BookingRecoveryToken" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_create' AND tempocove_public_booking_claim("bookingId") AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND EXISTS(SELECT 1 FROM "Booking" b WHERE b.id="bookingId" AND lower(b."inviteeEmail")=lower(email)));
CREATE POLICY app_public_recovery_read ON "BookingRecoveryToken" FOR SELECT TO tempocove_app USING (tempocove_public_booking_claim("bookingId"));

-- Auth/bootstrap authority is deliberately narrow and signed. It supports login, generic
-- recovery and atomic registration without granting a direct SQL login a cross-tenant view.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY; ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY app_user_context ON "User" FOR SELECT TO tempocove_app
USING (tempocove_context_valid(NULL) AND (
  current_setting('tempocove.user_id',true)=id OR lower(split_part(current_setting('tempocove.subject',true),'|',1))=lower(email)
  OR tempocove_live_member(current_setting('tempocove.workspace_id',true),id)
  OR (current_setting('tempocove.mode',true)='public' AND tempocove_public_event_relation(split_part(current_setting('tempocove.subject',true),'|',1),NULL,id))
));
CREATE POLICY app_user_update ON "User" FOR UPDATE TO tempocove_app USING (current_setting('tempocove.action',true)='account_write' AND tempocove_workspace_access(current_setting('tempocove.workspace_id',true)) AND id=current_setting('tempocove.user_id',true)) WITH CHECK (current_setting('tempocove.action',true)='account_write' AND id=current_setting('tempocove.user_id',true));
CREATE POLICY app_bootstrap_user ON "User" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('bootstrap') AND id=current_setting('tempocove.user_id',true) AND lower(email)=lower(split_part(current_setting('tempocove.subject',true),'|',1)));
CREATE POLICY app_bootstrap_workspace ON "Workspace" FOR ALL TO tempocove_app USING (tempocove_context_valid('bootstrap') AND id=current_setting('tempocove.workspace_id',true)) WITH CHECK (tempocove_context_valid('bootstrap') AND id=current_setting('tempocove.workspace_id',true));
CREATE POLICY app_bootstrap_membership ON "Membership" FOR ALL TO tempocove_app USING (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true)) WITH CHECK (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true) AND role='OWNER' AND status='ACTIVE');
CREATE POLICY app_bootstrap_branding ON "WorkspaceBranding" FOR ALL TO tempocove_app USING (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true)) WITH CHECK (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true));
CREATE POLICY app_bootstrap_availability ON "AvailabilitySchedule" FOR ALL TO tempocove_app USING (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true)) WITH CHECK (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true));
CREATE POLICY app_bootstrap_account_token ON "AccountActionToken" FOR ALL TO tempocove_app USING (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true)) WITH CHECK (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "userId"=current_setting('tempocove.user_id',true) AND purpose='EMAIL_VERIFY');
CREATE POLICY app_bootstrap_email ON "EmailOutbox" FOR ALL TO tempocove_app USING (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "bookingId" IS NULL) WITH CHECK (tempocove_context_valid('bootstrap') AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND "bookingId" IS NULL AND kind='EMAIL_VERIFY');
CREATE POLICY app_invitation_email_insert ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='invitation_write' AND "bookingId" IS NULL AND kind='WORKSPACE_INVITATION' AND tempocove_workspace_admin("workspaceId") AND EXISTS(SELECT 1 FROM "WorkspaceInvitation" i WHERE i."workspaceId"="EmailOutbox"."workspaceId" AND lower(i.email)=lower("recipientEmail") AND i.id=("payloadJson"::jsonb->>'invitationId')));
CREATE POLICY app_auth_email_insert ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('auth') AND "bookingId" IS NULL AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND lower("recipientEmail")=lower(current_setting('tempocove.subject',true)) AND ((current_setting('tempocove.action',true)='password_reset_request' AND kind='PASSWORD_RESET') OR (current_setting('tempocove.action',true)='email_verify_request' AND kind='EMAIL_VERIFY')));
CREATE POLICY app_auth_email_read ON "EmailOutbox" FOR SELECT TO tempocove_app USING (tempocove_context_valid('auth') AND "bookingId" IS NULL AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND lower("recipientEmail")=lower(current_setting('tempocove.subject',true)) AND ((current_setting('tempocove.action',true)='password_reset_request' AND kind='PASSWORD_RESET') OR (current_setting('tempocove.action',true)='email_verify_request' AND kind='EMAIL_VERIFY')));
CREATE POLICY app_auth_membership ON "Membership" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('auth') AND ("userId"=current_setting('tempocove.user_id',true) OR tempocove_user_email_matches("userId",current_setting('tempocove.subject',true)))
);
CREATE POLICY app_user_memberships ON "Membership" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid(NULL) AND current_setting('tempocove.mode',true) IN ('session','workspace') AND "userId"=current_setting('tempocove.user_id',true)
);
CREATE POLICY app_user_workspaces ON "Workspace" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid(NULL) AND current_setting('tempocove.mode',true) IN ('session','workspace') AND tempocove_live_member("Workspace".id,current_setting('tempocove.user_id',true))
);
CREATE POLICY app_auth_session ON "AuthSession" FOR INSERT TO tempocove_app WITH CHECK (
  tempocove_context_valid('auth') AND "userId"=current_setting('tempocove.user_id',true)
);
CREATE POLICY app_user_session_authority ON "AuthSession" FOR ALL TO tempocove_app USING (
  tempocove_context_valid(NULL) AND current_setting('tempocove.mode',true) IN ('auth','session','workspace') AND "userId"=current_setting('tempocove.user_id',true)
) WITH CHECK (tempocove_context_valid(NULL) AND current_setting('tempocove.mode',true) IN ('auth','session','workspace') AND "userId"=current_setting('tempocove.user_id',true));
CREATE POLICY app_session_lookup ON "AuthSession" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('session') AND "tokenHash"=current_setting('tempocove.session_hash',true)
  AND "userId"=current_setting('tempocove.user_id',true)
);

-- Tenant children without their own workspace column inherit it from an enforced parent.
DO $child_rls$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('EventDuration','eventTypeId','EventType'),('CustomQuestion','eventTypeId','EventType'),
    ('AvailabilityInterval','scheduleId','AvailabilitySchedule'),('BookingAnswer','bookingId','Booking'),
    ('BookingCapability','bookingId','Booking'),('BookingManageSession','bookingId','Booking')
  ) AS v(child_table,parent_column,parent_table) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item.child_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item.child_table);
    EXECUTE format('CREATE POLICY app_parent_workspace_read ON %I FOR SELECT TO tempocove_app USING (EXISTS (SELECT 1 FROM %I p WHERE p.id=%I.%I AND tempocove_workspace_access(p."workspaceId")))',item.child_table,item.parent_table,item.child_table,item.parent_column);
  END LOOP;
END $child_rls$;
CREATE POLICY app_event_duration_write ON "EventDuration" FOR ALL TO tempocove_app USING (current_setting('tempocove.action',true)='event_write' AND EXISTS(SELECT 1 FROM "EventType" e WHERE e.id="eventTypeId" AND tempocove_workspace_admin(e."workspaceId"))) WITH CHECK (current_setting('tempocove.action',true)='event_write' AND EXISTS(SELECT 1 FROM "EventType" e WHERE e.id="eventTypeId" AND tempocove_workspace_admin(e."workspaceId")));
CREATE POLICY app_event_question_write ON "CustomQuestion" FOR ALL TO tempocove_app USING (current_setting('tempocove.action',true)='event_write' AND EXISTS(SELECT 1 FROM "EventType" e WHERE e.id="eventTypeId" AND tempocove_workspace_admin(e."workspaceId"))) WITH CHECK (current_setting('tempocove.action',true)='event_write' AND EXISTS(SELECT 1 FROM "EventType" e WHERE e.id="eventTypeId" AND tempocove_workspace_admin(e."workspaceId")));
CREATE POLICY app_availability_interval_write ON "AvailabilityInterval" FOR ALL TO tempocove_app USING (current_setting('tempocove.action',true)='availability_write' AND EXISTS(SELECT 1 FROM "AvailabilitySchedule" s WHERE s.id="scheduleId" AND tempocove_workspace_actor(s."workspaceId",s."userId"))) WITH CHECK (current_setting('tempocove.action',true)='availability_write' AND EXISTS(SELECT 1 FROM "AvailabilitySchedule" s WHERE s.id="scheduleId" AND tempocove_workspace_actor(s."workspaceId",s."userId")));
CREATE POLICY app_booking_answer_write ON "BookingAnswer" FOR UPDATE TO tempocove_app USING (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId")) WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId"));
CREATE POLICY app_booking_capability_write ON "BookingCapability" FOR UPDATE TO tempocove_app USING (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId")) WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId"));
CREATE POLICY app_booking_manage_write ON "BookingManageSession" FOR UPDATE TO tempocove_app USING (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId")) WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND tempocove_booking_actor("bookingId"));
CREATE POLICY app_public_answer_claim ON "BookingAnswer" FOR INSERT TO tempocove_app WITH CHECK (tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_capability_claim ON "BookingCapability" FOR INSERT TO tempocove_app WITH CHECK (tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_answer_read ON "BookingAnswer" FOR SELECT TO tempocove_app USING (tempocove_public_booking_claim("bookingId"));
CREATE POLICY app_public_capability_read ON "BookingCapability" FOR SELECT TO tempocove_app USING (tempocove_public_booking_claim("bookingId"));

-- Capability contexts are restricted to the exact server-bound booking.
CREATE POLICY app_capability_booking ON "Booking" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND id=current_setting('tempocove.subject',true)
);
CREATE POLICY app_capability_booking_write ON "Booking" FOR UPDATE TO tempocove_app USING (
  tempocove_context_valid('capability') AND current_setting('tempocove.action',true) IN ('booking_write','booking_recovery_consume') AND id=current_setting('tempocove.subject',true)
) WITH CHECK (tempocove_context_valid('capability') AND current_setting('tempocove.action',true) IN ('booking_write','booking_recovery_consume') AND id=current_setting('tempocove.subject',true));
CREATE POLICY app_capability_peer_booking ON "Booking" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),"workspaceId",NULL,"hostId",NULL)
);
CREATE OR REPLACE FUNCTION tempocove_capability_booking(row_booking text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT tempocove_context_valid('capability') AND row_booking=current_setting('tempocove.subject',true)
$fn$;
REVOKE ALL ON FUNCTION tempocove_capability_booking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_capability_booking(text) TO tempocove_app;
CREATE POLICY app_capability_occupancy_delete ON "BookingOccupancy" FOR DELETE TO tempocove_app USING (current_setting('tempocove.action',true)='booking_write' AND tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_occupancy_insert ON "BookingOccupancy" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_peer_occupancy ON "BookingOccupancy" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),"workspaceId",NULL,"hostId",NULL)
);
CREATE POLICY app_capability_integration ON "IntegrationOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true)='booking_write' AND tempocove_capability_booking("bookingId") AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL);
CREATE POLICY app_capability_email ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (current_setting('tempocove.action',true) IN ('booking_write','booking_recovery_request') AND "bookingId" IS NOT NULL AND tempocove_capability_booking("bookingId") AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL);
CREATE POLICY app_capability_integration_read ON "IntegrationOutbox" FOR SELECT TO tempocove_app USING (tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_email_read ON "EmailOutbox" FOR SELECT TO tempocove_app USING ("bookingId" IS NOT NULL AND tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_answer ON "BookingAnswer" FOR SELECT TO tempocove_app USING (tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_cap ON "BookingCapability" FOR ALL TO tempocove_app USING (current_setting('tempocove.action',true) IN ('capability','booking_write','booking_recovery_consume') AND tempocove_capability_booking("bookingId")) WITH CHECK (current_setting('tempocove.action',true) IN ('capability','booking_write','booking_recovery_consume') AND tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_manage ON "BookingManageSession" FOR ALL TO tempocove_app USING (current_setting('tempocove.action',true) IN ('capability','booking_write','booking_recovery_consume') AND tempocove_capability_booking("bookingId")) WITH CHECK (current_setting('tempocove.action',true) IN ('capability','booking_write','booking_recovery_consume') AND tempocove_capability_booking("bookingId"));
CREATE POLICY app_capability_event ON "EventType" FOR SELECT TO tempocove_app USING (tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),NULL,id,NULL,NULL));
CREATE POLICY app_capability_workspace ON "Workspace" FOR SELECT TO tempocove_app USING (tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),id,NULL,NULL,NULL));
CREATE POLICY app_capability_host ON "User" FOR SELECT TO tempocove_app USING (tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),NULL,NULL,id,NULL));
CREATE POLICY app_capability_duration ON "EventDuration" FOR SELECT TO tempocove_app USING (tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),NULL,"eventTypeId",NULL,NULL));
CREATE POLICY app_capability_question ON "CustomQuestion" FOR SELECT TO tempocove_app USING (tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),NULL,"eventTypeId",NULL,NULL));
CREATE POLICY app_capability_branding ON "WorkspaceBranding" FOR SELECT TO tempocove_app USING (tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),"workspaceId",NULL,NULL,NULL));
CREATE POLICY app_capability_schedule ON "AvailabilitySchedule" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),"workspaceId",NULL,"userId",NULL)
);
CREATE POLICY app_capability_interval ON "AvailabilityInterval" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND EXISTS (SELECT 1 FROM "AvailabilitySchedule" s WHERE s.id="scheduleId" AND tempocove_booking_relation(current_setting('tempocove.subject',true),s."workspaceId",NULL,s."userId",NULL))
);
CREATE POLICY app_capability_override ON "AvailabilityOverride" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND tempocove_booking_relation(current_setting('tempocove.subject',true),"workspaceId",NULL,"userId",NULL)
);
CREATE POLICY app_auth_account_token_select ON "AccountActionToken" FOR SELECT TO tempocove_app USING (tempocove_context_valid('auth') AND current_setting('tempocove.action',true) IN ('password_reset_request','email_verify_request') AND "userId"=current_setting('tempocove.user_id',true) AND "workspaceId"=current_setting('tempocove.workspace_id',true));
CREATE POLICY app_auth_account_token_consume_select ON "AccountActionToken" FOR SELECT TO tempocove_app USING (tempocove_context_valid('auth') AND current_setting('tempocove.action',true) IN ('password_reset_consume','email_verify_consume') AND "userId"=current_setting('tempocove.user_id',true) AND "workspaceId"=current_setting('tempocove.workspace_id',true));
CREATE POLICY app_auth_account_token_update ON "AccountActionToken" FOR UPDATE TO tempocove_app USING (tempocove_context_valid('auth') AND current_setting('tempocove.action',true) IN ('password_reset_request','email_verify_request') AND "userId"=current_setting('tempocove.user_id',true) AND "workspaceId"=current_setting('tempocove.workspace_id',true)) WITH CHECK ("userId"=current_setting('tempocove.user_id',true) AND "workspaceId"=current_setting('tempocove.workspace_id',true));
CREATE POLICY app_auth_account_token_insert ON "AccountActionToken" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('auth') AND ((current_setting('tempocove.action',true)='password_reset_request' AND purpose='PASSWORD_RESET') OR (current_setting('tempocove.action',true)='email_verify_request' AND purpose='EMAIL_VERIFY')) AND "userId"=current_setting('tempocove.user_id',true) AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND lower(email)=lower(current_setting('tempocove.subject',true)));
CREATE POLICY app_capability_recovery ON "BookingRecoveryToken" FOR ALL TO tempocove_app
USING (tempocove_context_valid('capability') AND current_setting('tempocove.action',true) IN ('booking_recovery_request','booking_recovery_consume') AND "bookingId"=current_setting('tempocove.subject',true))
WITH CHECK (tempocove_context_valid('capability') AND current_setting('tempocove.action',true) IN ('booking_recovery_request','booking_recovery_consume') AND "bookingId"=current_setting('tempocove.subject',true));
CREATE POLICY app_capability_recovery_token ON "BookingRecoveryToken" FOR SELECT TO tempocove_app
USING (tempocove_context_valid('capability') AND current_setting('tempocove.action',true)='booking_recovery_resolve' AND id=current_setting('tempocove.subject',true));
CREATE POLICY app_capability_account ON "AccountActionToken" FOR SELECT TO tempocove_app
USING (tempocove_context_valid('capability') AND current_setting('tempocove.action',true)='account_token_resolve' AND id=current_setting('tempocove.subject',true));
CREATE POLICY app_invitation_authority ON "WorkspaceInvitation" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND current_setting('tempocove.action',true)='invitation_accept' AND id=current_setting('tempocove.subject',true)
);
CREATE POLICY app_invitation_membership_read ON "Membership" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND tempocove_invitation_matches(current_setting('tempocove.subject',true),"Membership"."workspaceId","Membership"."userId")
);
CREATE POLICY app_invitation_user ON "User" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('capability') AND EXISTS (SELECT 1 FROM "WorkspaceInvitation" i WHERE i.id=current_setting('tempocove.subject',true) AND lower(i.email)=lower("User".email))
);

-- Sensitive invitation and account consumes are atomic SECURITY DEFINER operations. Direct
-- Membership insertion and direct User password/verification updates remain unavailable.
CREATE OR REPLACE FUNCTION tempocove_accept_invitation(p_id text,p_token_hash text,p_now timestamptz)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE i "WorkspaceInvitation"%ROWTYPE; accepted_user text; affected integer;
BEGIN
  IF NOT tempocove_context_valid('capability') OR current_setting('tempocove.action',true)<>'invitation_accept' OR current_setting('tempocove.subject',true)<>p_id THEN RETURN NULL; END IF;
  SELECT * INTO i FROM "WorkspaceInvitation" WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR i.status<>'PENDING' OR i."acceptedAt" IS NOT NULL OR i."expiresAt"<=p_now OR i."tokenHash" IS DISTINCT FROM p_token_hash OR i.role NOT IN ('ADMIN','MEMBER') THEN RETURN NULL; END IF;
  accepted_user:=current_setting('tempocove.user_id',true);
  IF NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=accepted_user AND u."emailVerifiedAt" IS NOT NULL AND lower(u.email)=lower(i.email))
     OR NOT EXISTS(SELECT 1 FROM "Membership" m WHERE m."workspaceId"=i."workspaceId" AND m."userId"=i."invitedById" AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN'))
     OR EXISTS(SELECT 1 FROM "Membership" m WHERE m."workspaceId"=i."workspaceId" AND m."userId"=accepted_user AND m.status='ACTIVE') THEN RETURN NULL; END IF;
  INSERT INTO "Membership"(id,"workspaceId","userId",role,status,"createdAt","updatedAt") VALUES(encode(gen_random_bytes(18),'hex'),i."workspaceId",accepted_user,i.role,'ACTIVE',p_now,p_now)
    ON CONFLICT("workspaceId","userId") DO UPDATE SET role=EXCLUDED.role,status='ACTIVE',"updatedAt"=p_now WHERE "Membership".status<>'ACTIVE';
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RETURN NULL; END IF;
  UPDATE "WorkspaceInvitation" SET status='ACCEPTED',"acceptedAt"=p_now,"acceptedById"=accepted_user,"tokenHash"=NULL WHERE id=i.id AND status='PENDING' AND "tokenHash"=p_token_hash;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'invitation consume lost authority' USING ERRCODE='40001'; END IF;
  RETURN i."workspaceId";
END $fn$;
CREATE OR REPLACE FUNCTION tempocove_consume_email_verification(p_id text,p_token_hash text,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r "AccountActionToken"%ROWTYPE; affected integer;
BEGIN
  IF NOT tempocove_context_valid('auth') OR current_setting('tempocove.action',true)<>'email_verify_consume' THEN RETURN false; END IF;
  SELECT * INTO r FROM "AccountActionToken" WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.purpose<>'EMAIL_VERIFY' OR r."tokenHash" IS DISTINCT FROM p_token_hash OR r."consumedAt" IS NOT NULL OR r."revokedAt" IS NOT NULL OR r."expiresAt"<=p_now OR r."userId"<>current_setting('tempocove.user_id',true) OR r."workspaceId"<>current_setting('tempocove.workspace_id',true) THEN RETURN false; END IF;
  UPDATE "AccountActionToken" SET "consumedAt"=p_now WHERE id=r.id AND "consumedAt" IS NULL AND "revokedAt" IS NULL;
  UPDATE "User" SET "emailVerifiedAt"=p_now,"updatedAt"=p_now WHERE id=r."userId" AND lower(email)=lower(r.email); GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
END $fn$;
CREATE OR REPLACE FUNCTION tempocove_consume_password_reset(p_id text,p_token_hash text,p_password_hash text,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r "AccountActionToken"%ROWTYPE; affected integer;
BEGIN
  IF NOT tempocove_context_valid('auth') OR current_setting('tempocove.action',true)<>'password_reset_consume' OR length(p_password_hash)<20 THEN RETURN false; END IF;
  SELECT * INTO r FROM "AccountActionToken" WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.purpose<>'PASSWORD_RESET' OR r."tokenHash" IS DISTINCT FROM p_token_hash OR r."consumedAt" IS NOT NULL OR r."revokedAt" IS NOT NULL OR r."expiresAt"<=p_now OR r."userId"<>current_setting('tempocove.user_id',true) OR r."workspaceId"<>current_setting('tempocove.workspace_id',true) THEN RETURN false; END IF;
  UPDATE "AccountActionToken" SET "consumedAt"=p_now WHERE id=r.id AND "consumedAt" IS NULL AND "revokedAt" IS NULL;
  UPDATE "User" SET "passwordHash"=p_password_hash,"updatedAt"=p_now WHERE id=r."userId"; GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RETURN false; END IF;
  UPDATE "AuthSession" SET "revokedAt"=p_now WHERE "userId"=r."userId" AND "revokedAt" IS NULL;
  UPDATE "AccountActionToken" SET "revokedAt"=p_now WHERE "userId"=r."userId" AND purpose='PASSWORD_RESET' AND id<>r.id AND "consumedAt" IS NULL AND "revokedAt" IS NULL;
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION tempocove_accept_invitation(text,text,timestamptz),tempocove_consume_email_verification(text,text,timestamptz),tempocove_consume_password_reset(text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_accept_invitation(text,text,timestamptz),tempocove_consume_email_verification(text,text,timestamptz),tempocove_consume_password_reset(text,text,text,timestamptz) TO tempocove_app;

-- Global operational tables carry no tenant data. Provider webhook authority is still signed.
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "WebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY app_provider_webhook ON "WebhookEvent" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND id=split_part(current_setting('tempocove.subject',true),'|',2));
CREATE POLICY app_provider_webhook_insert ON "WebhookEvent" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND id=split_part(current_setting('tempocove.subject',true),'|',2));
CREATE POLICY app_provider_webhook_update ON "WebhookEvent" FOR UPDATE TO tempocove_app USING (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND id=split_part(current_setting('tempocove.subject',true),'|',2)) WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND id=split_part(current_setting('tempocove.subject',true),'|',2));
CREATE POLICY app_provider_booking ON "Booking" FOR UPDATE TO tempocove_app USING (
  tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND id=split_part(current_setting('tempocove.subject',true),'|',1)
) WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND id=split_part(current_setting('tempocove.subject',true),'|',1));
CREATE POLICY app_provider_booking_read ON "Booking" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND id=split_part(current_setting('tempocove.subject',true),'|',1));
CREATE POLICY app_provider_event ON "EventType" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND tempocove_booking_relation(split_part(current_setting('tempocove.subject',true),'|',1),NULL,id,NULL,NULL));
CREATE POLICY app_provider_host ON "User" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND tempocove_booking_relation(split_part(current_setting('tempocove.subject',true),'|',1),NULL,NULL,id,NULL));
CREATE POLICY app_provider_occupancy ON "BookingOccupancy" FOR DELETE TO tempocove_app USING (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));
CREATE POLICY app_provider_outbox ON "IntegrationOutbox" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1) AND EXISTS(SELECT 1 FROM "Booking" b WHERE b.id="bookingId" AND b."workspaceId"="IntegrationOutbox"."workspaceId") AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL);
CREATE POLICY app_provider_email ON "EmailOutbox" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1) AND EXISTS(SELECT 1 FROM "Booking" b JOIN "User" h ON h.id=b."hostId" WHERE b.id="bookingId" AND b."workspaceId"="EmailOutbox"."workspaceId" AND lower("recipientEmail") IN (lower(b."inviteeEmail"),lower(h.email)) AND ("bookingMutationVersion" IS NULL OR "bookingMutationVersion"=b."mutationVersion")) AND status='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL);
CREATE POLICY app_provider_outbox_read ON "IntegrationOutbox" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));
CREATE POLICY app_provider_email_read ON "EmailOutbox" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));
CREATE POLICY app_provider_recovery_update ON "BookingRecoveryToken" FOR UPDATE TO tempocove_app USING (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1)) WITH CHECK ("bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));
CREATE POLICY app_provider_recovery_insert ON "BookingRecoveryToken" FOR INSERT TO tempocove_app WITH CHECK (tempocove_context_valid('provider') AND current_setting('tempocove.action',true)='provider_commit' AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1) AND EXISTS(SELECT 1 FROM "Booking" b WHERE b.id="bookingId" AND b."workspaceId"="BookingRecoveryToken"."workspaceId" AND lower(b."inviteeEmail")=lower(email)));
CREATE POLICY app_provider_recovery_read ON "BookingRecoveryToken" FOR SELECT TO tempocove_app USING (tempocove_context_valid('provider') AND "bookingId"=split_part(current_setting('tempocove.subject',true),'|',1));
ALTER TABLE "RateLimitBucket" ENABLE ROW LEVEL SECURITY; ALTER TABLE "RateLimitBucket" FORCE ROW LEVEL SECURITY;
CREATE TABLE tempocove_rate_policy(limit_value integer NOT NULL,window_ms integer NOT NULL,PRIMARY KEY(limit_value,window_ms));
INSERT INTO tempocove_rate_policy VALUES (3,3600000),(4,3600000),(5,3600000),(8,3600000),(8,900000),(10,3600000),(10,60000),(12,3600000),(12,900000),(20,3600000),(20,900000),(30,3600000),(30,900000),(30,60000),(120,60000),(240,60000);
REVOKE ALL ON tempocove_rate_policy FROM PUBLIC,tempocove_app,tempocove_worker,tempocove_monitor;
CREATE TABLE tempocove_rate_configuration(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),max_buckets integer NOT NULL CHECK(max_buckets BETWEEN 1 AND 100000));
INSERT INTO tempocove_rate_configuration(singleton,max_buckets) VALUES(true,100000);
REVOKE ALL ON tempocove_rate_configuration FROM PUBLIC,tempocove_app,tempocove_worker,tempocove_monitor;
ALTER TABLE tempocove_rate_policy ENABLE ROW LEVEL SECURITY; ALTER TABLE tempocove_rate_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE tempocove_rate_configuration ENABLE ROW LEVEL SECURITY; ALTER TABLE tempocove_rate_configuration FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_policy_internal ON tempocove_rate_policy FOR SELECT TO tempocove_migration USING (true);
CREATE POLICY rate_configuration_internal ON tempocove_rate_configuration FOR SELECT TO tempocove_migration USING (true);
CREATE OR REPLACE FUNCTION tempocove_rate_limit(p_key text,p_limit integer,p_at timestamptz,p_window_end timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE current_count integer; existing_window timestamptz;
BEGIN
  IF p_key !~ '^[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM tempocove_rate_policy WHERE limit_value=p_limit AND window_ms=round(extract(epoch FROM (p_window_end-p_at))*1000)::integer) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key,860217451));
  SELECT count,"windowEnd" INTO current_count,existing_window FROM "RateLimitBucket" WHERE "keyHash"=p_key;
  IF current_count IS NULL THEN
    PERFORM pg_advisory_xact_lock(860217453);
    DELETE FROM "RateLimitBucket" WHERE "windowEnd" < p_at - interval '1 minute';
    IF (SELECT count(*) FROM "RateLimitBucket") >= (SELECT max_buckets FROM tempocove_rate_configuration WHERE singleton) THEN RETURN false; END IF;
    INSERT INTO "RateLimitBucket"("keyHash",count,"windowEnd","updatedAt") VALUES(p_key,1,p_window_end,clock_timestamp()); RETURN true;
  END IF;
  IF existing_window<=p_at THEN UPDATE "RateLimitBucket" SET count=1,"windowEnd"=p_window_end,"updatedAt"=clock_timestamp() WHERE "keyHash"=p_key; RETURN true; END IF;
  IF current_count>=p_limit THEN RETURN false; END IF;
  UPDATE "RateLimitBucket" SET count=count+1,"updatedAt"=clock_timestamp() WHERE "keyHash"=p_key; RETURN true;
END $fn$;
REVOKE ALL ON "RateLimitBucket" FROM tempocove_app;
REVOKE ALL ON FUNCTION tempocove_rate_limit(text,integer,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_rate_limit(text,integer,timestamptz,timestamptz) TO tempocove_app;
ALTER TABLE "WorkerHeartbeat" ENABLE ROW LEVEL SECURITY; ALTER TABLE "WorkerHeartbeat" FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION tempocove_readiness(p_max_age_ms integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT p_max_age_ms BETWEEN 5000 AND 300000 AND current_setting('server_version_num')::int>=180000
    AND EXISTS(SELECT 1 FROM tempocove_schema_release WHERE migration_name='202608220100_production_baseline')
    AND EXISTS(SELECT 1 FROM "WorkerHeartbeat" WHERE status IN ('STARTING','RUNNING','IDLE') AND "lastSeenAt">(clock_timestamp() AT TIME ZONE 'UTC')-make_interval(secs=>p_max_age_ms/1000.0))
$fn$;
CREATE OR REPLACE FUNCTION tempocove_operator_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
  SELECT jsonb_build_object('integrationPending',(SELECT count(*) FROM "IntegrationOutbox" WHERE status IN ('PENDING','RETRY','PROCESSING')),
    'integrationDead',(SELECT count(*) FROM "IntegrationOutbox" WHERE status='DEAD'),'emailPending',(SELECT count(*) FROM "EmailOutbox" WHERE status IN ('PENDING','RETRY','PROCESSING')),
    'emailDead',(SELECT count(*) FROM "EmailOutbox" WHERE status='DEAD'),'worker',(SELECT to_jsonb(x) FROM (SELECT status,"lastSeenAt","buildId" FROM "WorkerHeartbeat" ORDER BY "lastSeenAt" DESC LIMIT 1)x))
$fn$;
REVOKE ALL ON FUNCTION tempocove_readiness(integer),tempocove_operator_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_readiness(integer),tempocove_operator_health() TO tempocove_app,tempocove_monitor;

-- Worker and monitor authority is explicit and cannot be borrowed by the application login.
DO $worker_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['IntegrationOutbox','EmailOutbox','Booking','OAuthConnection','LocalInboxMessage','WorkerHeartbeat'] LOOP
    EXECUTE format('CREATE POLICY worker_effects ON %I FOR ALL TO tempocove_worker USING (true) WITH CHECK (true)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['EventType','User','Workspace','Membership','BookingRecoveryToken','AccountActionToken','WorkspaceInvitation'] LOOP
    EXECUTE format('CREATE POLICY worker_reference ON %I FOR SELECT TO tempocove_worker USING (true)',table_name);
  END LOOP;
END $worker_rls$;
CREATE POLICY monitor_heartbeat ON "WorkerHeartbeat" FOR SELECT TO tempocove_monitor USING (true);

-- A non-login schema owner performs later migrations through a dedicated LOGIN member. It is
-- subject to explicit policies rather than relying on owner or BYPASSRLS behavior.
DO $migration_policy$
DECLARE table_name text;
BEGIN
  FOR table_name IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity LOOP
    EXECUTE format('CREATE POLICY migration_authority ON %I FOR ALL TO tempocove_migration USING (true) WITH CHECK (true)',table_name);
  END LOOP;
END $migration_policy$;
GRANT USAGE,CREATE ON SCHEMA public TO tempocove_migration;
GRANT ALL ON ALL TABLES IN SCHEMA public TO tempocove_migration;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO tempocove_migration;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tempocove_migration;
DO $ownership$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO tempocove_migration',item.relname);
  END LOOP;
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype IN ('a','i')) LOOP
    EXECUTE format('ALTER SEQUENCE %I OWNER TO tempocove_migration',item.relname);
  END LOOP;
  FOR item IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname<>'tempocove_context_valid' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO tempocove_migration',item.identity);
  END LOOP;
END $ownership$;
ALTER SCHEMA public OWNER TO tempocove_migration;
ALTER DEFAULT PRIVILEGES FOR ROLE tempocove_migration IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE tempocove_migration IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE tempocove_migration IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
REVOKE tempocove_app,tempocove_worker,tempocove_monitor FROM tempocove_migration_login;
