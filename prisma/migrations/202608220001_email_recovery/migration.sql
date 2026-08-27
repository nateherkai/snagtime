-- Durable, workspace-bound transactional email and one-use recovery authority.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
UPDATE "User" SET "emailVerifiedAt"=CURRENT_TIMESTAMP;

ALTER TABLE "WorkspaceInvitation" ADD COLUMN "acceptedById" TEXT;
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "WorkspaceInvitation" SET "status"='REVOKED' WHERE "status"='PENDING';
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");

CREATE TABLE "AccountActionToken" (
  "id" TEXT NOT NULL PRIMARY KEY,"workspaceId" TEXT NOT NULL,"userId" TEXT NOT NULL,"purpose" TEXT NOT NULL,"email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,"expiresAt" DATETIME NOT NULL,"consumedAt" DATETIME,"revokedAt" DATETIME,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountActionToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccountActionToken_tokenHash_key" ON "AccountActionToken"("tokenHash");
CREATE INDEX "AccountActionToken_userId_purpose_expiresAt_idx" ON "AccountActionToken"("userId","purpose","expiresAt");
CREATE INDEX "AccountActionToken_workspaceId_purpose_idx" ON "AccountActionToken"("workspaceId","purpose");

CREATE TABLE "BookingRecoveryToken" (
  "id" TEXT NOT NULL PRIMARY KEY,"workspaceId" TEXT NOT NULL,"bookingId" TEXT NOT NULL,"email" TEXT NOT NULL,"tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,"consumedAt" DATETIME,"revokedAt" DATETIME,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingRecoveryToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BookingRecoveryToken_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BookingRecoveryToken_tokenHash_key" ON "BookingRecoveryToken"("tokenHash");
CREATE INDEX "BookingRecoveryToken_bookingId_expiresAt_idx" ON "BookingRecoveryToken"("bookingId","expiresAt");
CREATE INDEX "BookingRecoveryToken_workspaceId_email_idx" ON "BookingRecoveryToken"("workspaceId","email");

CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,"workspaceId" TEXT NOT NULL,"bookingId" TEXT,"kind" TEXT NOT NULL,"recipientEmail" TEXT NOT NULL,
  "subjectSnapshot" TEXT NOT NULL,"payloadJson" TEXT NOT NULL,"bookingMutationVersion" INTEGER,"status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,"attemptCount" INTEGER NOT NULL DEFAULT 0,"nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,"leaseExpiresAt" DATETIME,"lastErrorCode" TEXT,"completedAt" DATETIME,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL,
  CONSTRAINT "EmailOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmailOutbox_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailOutbox_idempotencyKey_key" ON "EmailOutbox"("idempotencyKey");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status","nextAttemptAt");
CREATE INDEX "EmailOutbox_workspaceId_status_idx" ON "EmailOutbox"("workspaceId","status");
CREATE INDEX "EmailOutbox_leaseExpiresAt_idx" ON "EmailOutbox"("leaseExpiresAt");

CREATE TABLE "LocalInboxMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,"workspaceId" TEXT NOT NULL,"outboxId" TEXT NOT NULL,"recipientEmail" TEXT NOT NULL,"subject" TEXT NOT NULL,
  "encryptedText" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocalInboxMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocalInboxMessage_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "EmailOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocalInboxMessage_outboxId_key" ON "LocalInboxMessage"("outboxId");
CREATE INDEX "LocalInboxMessage_workspaceId_createdAt_idx" ON "LocalInboxMessage"("workspaceId","createdAt");

CREATE TRIGGER "BookingRecoveryToken_workspace_guard_insert" BEFORE INSERT ON "BookingRecoveryToken"
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId" AND lower(b."inviteeEmail")=lower(NEW."email"))
BEGIN SELECT RAISE(ABORT,'booking recovery workspace mismatch'); END;
CREATE TRIGGER "BookingRecoveryToken_workspace_guard_update" BEFORE UPDATE ON "BookingRecoveryToken"
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId" AND lower(b."inviteeEmail")=lower(NEW."email"))
BEGIN SELECT RAISE(ABORT,'booking recovery workspace mismatch'); END;
CREATE TRIGGER "EmailOutbox_booking_guard_insert" BEFORE INSERT ON "EmailOutbox"
FOR EACH ROW WHEN NEW."bookingId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId")
BEGIN SELECT RAISE(ABORT,'email outbox workspace mismatch'); END;
CREATE TRIGGER "EmailOutbox_booking_guard_update" BEFORE UPDATE ON "EmailOutbox"
FOR EACH ROW WHEN NEW."bookingId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId")
BEGIN SELECT RAISE(ABORT,'email outbox workspace mismatch'); END;

CREATE TRIGGER "AccountActionToken_membership_guard_insert" BEFORE INSERT ON "AccountActionToken"
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'account action workspace mismatch'); END;
CREATE TRIGGER "AccountActionToken_identity_immutable" BEFORE UPDATE OF "workspaceId","userId","purpose","email","tokenHash" ON "AccountActionToken"
FOR EACH ROW WHEN NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."userId" IS NOT OLD."userId" OR NEW."purpose" IS NOT OLD."purpose" OR NEW."email" IS NOT OLD."email" OR NEW."tokenHash" IS NOT OLD."tokenHash"
BEGIN SELECT RAISE(ABORT,'account action identity is immutable'); END;
CREATE TRIGGER "BookingRecoveryToken_identity_immutable" BEFORE UPDATE OF "workspaceId","bookingId","email","tokenHash" ON "BookingRecoveryToken"
FOR EACH ROW WHEN NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."bookingId" IS NOT OLD."bookingId" OR NEW."email" IS NOT OLD."email" OR NEW."tokenHash" IS NOT OLD."tokenHash"
BEGIN SELECT RAISE(ABORT,'booking recovery identity is immutable'); END;
CREATE TRIGGER "EmailOutbox_snapshot_immutable" BEFORE UPDATE OF "workspaceId","bookingId","kind","recipientEmail","subjectSnapshot","payloadJson","bookingMutationVersion","idempotencyKey" ON "EmailOutbox"
FOR EACH ROW WHEN NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."bookingId" IS NOT OLD."bookingId" OR NEW."kind" IS NOT OLD."kind" OR NEW."recipientEmail" IS NOT OLD."recipientEmail" OR NEW."subjectSnapshot" IS NOT OLD."subjectSnapshot" OR NEW."payloadJson" IS NOT OLD."payloadJson" OR NEW."bookingMutationVersion" IS NOT OLD."bookingMutationVersion" OR NEW."idempotencyKey" IS NOT OLD."idempotencyKey"
BEGIN SELECT RAISE(ABORT,'email outbox snapshot is immutable'); END;
CREATE TRIGGER "WorkspaceInvitation_identity_immutable" BEFORE UPDATE OF "workspaceId","email" ON "WorkspaceInvitation"
FOR EACH ROW WHEN NEW."workspaceId" IS NOT OLD."workspaceId" OR NEW."email" IS NOT OLD."email"
BEGIN SELECT RAISE(ABORT,'invitation identity is immutable'); END;
CREATE TRIGGER "WorkspaceInvitation_acceptance_guard" BEFORE UPDATE ON "WorkspaceInvitation"
FOR EACH ROW WHEN NEW."status"='ACCEPTED' AND (NEW."acceptedById" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "User" u JOIN "Membership" m ON m."userId"=u."id" AND m."workspaceId"=NEW."workspaceId" AND m."status"='ACTIVE'
  WHERE u."id"=NEW."acceptedById" AND lower(u."email")=lower(NEW."email")
))
BEGIN SELECT RAISE(ABORT,'invitation acceptance mismatch'); END;
