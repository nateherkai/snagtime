CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "onboardingCompletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER' CHECK ("role" IN ('OWNER','ADMIN','MEMBER')),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','REMOVED')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId","userId");
CREATE UNIQUE INDEX "Membership_id_workspaceId_key" ON "Membership"("id","workspaceId");
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId","status");

CREATE TABLE "WorkspaceInvitation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER' CHECK ("role" IN ('ADMIN','MEMBER')),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','REVOKED','ACCEPTED','EXPIRED')),
  "invitedById" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "acceptedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkspaceInvitation_workspaceId_email_status_key" ON "WorkspaceInvitation"("workspaceId","email","status");
CREATE INDEX "WorkspaceInvitation_email_status_idx" ON "WorkspaceInvitation"("email","status");

INSERT INTO "Workspace" ("id","name","timeZone","onboardingCompletedAt","createdAt","updatedAt")
SELECT 'ws_' || "id", CASE WHEN trim("name")='' THEN 'My Workspace' ELSE trim("name") || '''s Workspace' END, "timeZone", CURRENT_TIMESTAMP, "createdAt", CURRENT_TIMESTAMP FROM "User";
INSERT INTO "Membership" ("id","workspaceId","userId","role","status","createdAt","updatedAt")
SELECT 'mem_' || "id", 'ws_' || "id", "id", 'OWNER', 'ACTIVE', "createdAt", CURRENT_TIMESTAMP FROM "User";

ALTER TABLE "EventType" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySchedule" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityOverride" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBranding" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingOccupancy" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationOutbox" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD COLUMN "activeWorkspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD COLUMN "membershipId" TEXT REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthState" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthConnection" ADD COLUMN "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "EventType" SET "workspaceId"='ws_' || "ownerId";
UPDATE "AvailabilitySchedule" SET "workspaceId"='ws_' || "userId";
UPDATE "AvailabilityOverride" SET "workspaceId"='ws_' || "userId";
UPDATE "WorkspaceBranding" SET "workspaceId"='ws_' || "userId";
UPDATE "Booking" SET "workspaceId"=(SELECT e."workspaceId" FROM "EventType" e WHERE e."id"="Booking"."eventTypeId");
UPDATE "BookingOccupancy" SET "workspaceId"=(SELECT b."workspaceId" FROM "Booking" b WHERE b."id"="BookingOccupancy"."bookingId");
UPDATE "IntegrationOutbox" SET "workspaceId"=(SELECT b."workspaceId" FROM "Booking" b WHERE b."id"="IntegrationOutbox"."bookingId");
UPDATE "AuthSession" SET "activeWorkspaceId"='ws_' || "userId", "membershipId"='mem_' || "userId";
UPDATE "OAuthState" SET "workspaceId"=COALESCE((SELECT s."activeWorkspaceId" FROM "AuthSession" s WHERE s."id"="OAuthState"."authSessionId"),'ws_' || "userId");
UPDATE "OAuthConnection" SET "workspaceId"='ws_' || "userId";

CREATE TEMP TABLE "_workspace_migration_guard" ("failures" INTEGER NOT NULL CHECK ("failures"=0));
INSERT INTO "_workspace_migration_guard" SELECT
  (SELECT count(*) FROM "EventType" WHERE "workspaceId" IS NULL) +
  (SELECT count(*) FROM "AvailabilitySchedule" WHERE "workspaceId" IS NULL) +
  (SELECT count(*) FROM "AvailabilityOverride" WHERE "workspaceId" IS NULL) +
  (SELECT count(*) FROM "WorkspaceBranding" WHERE "workspaceId" IS NULL) +
  (SELECT count(*) FROM "Booking" WHERE "workspaceId" IS NULL OR "workspaceId" IS NOT (SELECT "workspaceId" FROM "EventType" WHERE "id"="Booking"."eventTypeId")) +
  (SELECT count(*) FROM "BookingOccupancy" WHERE "workspaceId" IS NULL OR "workspaceId" IS NOT (SELECT "workspaceId" FROM "Booking" WHERE "id"="BookingOccupancy"."bookingId")) +
  (SELECT count(*) FROM "IntegrationOutbox" WHERE "workspaceId" IS NULL OR "workspaceId" IS NOT (SELECT "workspaceId" FROM "Booking" WHERE "id"="IntegrationOutbox"."bookingId")) +
  (SELECT count(*) FROM "AuthSession" WHERE "activeWorkspaceId" IS NULL OR "membershipId" IS NULL) +
  (SELECT count(*) FROM "OAuthState" WHERE "workspaceId" IS NULL) +
  (SELECT count(*) FROM "OAuthConnection" WHERE "workspaceId" IS NULL);
DROP TABLE "_workspace_migration_guard";

DROP INDEX "AvailabilitySchedule_userId_key";
CREATE UNIQUE INDEX "AvailabilitySchedule_workspaceId_userId_key" ON "AvailabilitySchedule"("workspaceId","userId");
DROP INDEX "WorkspaceBranding_userId_key";
CREATE UNIQUE INDEX "WorkspaceBranding_workspaceId_key" ON "WorkspaceBranding"("workspaceId");
DROP INDEX "OAuthConnection_userId_provider_key";
CREATE UNIQUE INDEX "OAuthConnection_workspaceId_provider_key" ON "OAuthConnection"("workspaceId","provider");
CREATE INDEX "OAuthConnection_userId_provider_idx" ON "OAuthConnection"("userId","provider");
DROP INDEX "Booking_idempotencyKey_key";
CREATE UNIQUE INDEX "Booking_workspaceId_eventTypeId_idempotencyKey_key" ON "Booking"("workspaceId","eventTypeId","idempotencyKey");
DROP INDEX "BookingOccupancy_hostId_minuteStart_key";
CREATE UNIQUE INDEX "BookingOccupancy_workspaceId_hostId_minuteStart_key" ON "BookingOccupancy"("workspaceId","hostId","minuteStart");
CREATE INDEX "EventType_workspaceId_isActive_idx" ON "EventType"("workspaceId","isActive");
CREATE INDEX "Booking_workspaceId_startAt_endAt_idx" ON "Booking"("workspaceId","startAt","endAt");
CREATE INDEX "AvailabilityOverride_workspaceId_userId_dateKey_idx" ON "AvailabilityOverride"("workspaceId","userId","dateKey");

CREATE TRIGGER "EventType_workspace_guard_insert" BEFORE INSERT ON "EventType" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."ownerId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'workspace membership mismatch'); END;
CREATE TRIGGER "EventType_workspace_guard_update" BEFORE UPDATE OF "workspaceId","ownerId" ON "EventType" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."ownerId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'workspace membership mismatch'); END;
CREATE TRIGGER "Booking_workspace_guard_insert" BEFORE INSERT ON "Booking" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=NEW."hostId" AND m."status"='ACTIVE' WHERE e."id"=NEW."eventTypeId" AND e."workspaceId"=NEW."workspaceId") BEGIN SELECT RAISE(ABORT,'booking workspace mismatch'); END;
CREATE TRIGGER "Booking_workspace_guard_update" BEFORE UPDATE OF "workspaceId","eventTypeId","hostId" ON "Booking" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=NEW."hostId" AND m."status"='ACTIVE' WHERE e."id"=NEW."eventTypeId" AND e."workspaceId"=NEW."workspaceId") BEGIN SELECT RAISE(ABORT,'booking workspace mismatch'); END;
CREATE TRIGGER "BookingOccupancy_workspace_guard_insert" BEFORE INSERT ON "BookingOccupancy" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId" AND b."hostId"=NEW."hostId") BEGIN SELECT RAISE(ABORT,'occupancy workspace mismatch'); END;
CREATE TRIGGER "IntegrationOutbox_workspace_guard_insert" BEFORE INSERT ON "IntegrationOutbox" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId") BEGIN SELECT RAISE(ABORT,'outbox workspace mismatch'); END;
CREATE TRIGGER "AuthSession_workspace_guard_insert" BEFORE INSERT ON "AuthSession" FOR EACH ROW WHEN NEW."activeWorkspaceId" IS NULL OR NEW."membershipId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."id"=NEW."membershipId" AND m."workspaceId"=NEW."activeWorkspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'session workspace mismatch'); END;
CREATE TRIGGER "AuthSession_workspace_guard_update" BEFORE UPDATE OF "activeWorkspaceId","membershipId","userId" ON "AuthSession" FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."id"=NEW."membershipId" AND m."workspaceId"=NEW."activeWorkspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'session workspace mismatch'); END;
CREATE TRIGGER "AvailabilitySchedule_workspace_guard_insert" BEFORE INSERT ON "AvailabilitySchedule" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'availability workspace mismatch'); END;
CREATE TRIGGER "AvailabilityOverride_workspace_guard_insert" BEFORE INSERT ON "AvailabilityOverride" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'availability workspace mismatch'); END;
CREATE TRIGGER "WorkspaceBranding_workspace_guard_insert" BEFORE INSERT ON "WorkspaceBranding" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'branding workspace mismatch'); END;
CREATE TRIGGER "OAuthConnection_workspace_guard_insert" BEFORE INSERT ON "OAuthConnection" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE') BEGIN SELECT RAISE(ABORT,'oauth workspace mismatch'); END;
CREATE TRIGGER "OAuthState_workspace_guard_insert" BEFORE INSERT ON "OAuthState" FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NEW."authSessionId" IS NULL OR NOT EXISTS (SELECT 1 FROM "AuthSession" s WHERE s."id"=NEW."authSessionId" AND s."activeWorkspaceId"=NEW."workspaceId" AND s."userId"=NEW."userId" AND s."revokedAt" IS NULL) BEGIN SELECT RAISE(ABORT,'oauth state workspace mismatch'); END;
