-- Enforce tenant lineage and the last-owner invariant below the application layer.
CREATE TRIGGER "Membership_last_owner_update" BEFORE UPDATE OF "role","status" ON "Membership"
FOR EACH ROW WHEN OLD."role"='OWNER' AND OLD."status"='ACTIVE' AND (NEW."role"<>'OWNER' OR NEW."status"<>'ACTIVE')
  AND (SELECT count(*) FROM "Membership" WHERE "workspaceId"=OLD."workspaceId" AND "role"='OWNER' AND "status"='ACTIVE') <= 1
BEGIN SELECT RAISE(ABORT,'workspace requires an active owner'); END;

CREATE TRIGGER "AvailabilitySchedule_workspace_guard_update" BEFORE UPDATE OF "workspaceId","userId" ON "AvailabilitySchedule"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'availability workspace mismatch'); END;

CREATE TRIGGER "AvailabilityOverride_workspace_guard_update" BEFORE UPDATE OF "workspaceId","userId" ON "AvailabilityOverride"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'availability workspace mismatch'); END;

CREATE TRIGGER "WorkspaceBranding_workspace_guard_update" BEFORE UPDATE OF "workspaceId","userId" ON "WorkspaceBranding"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'branding workspace mismatch'); END;

CREATE TRIGGER "BookingOccupancy_workspace_guard_update" BEFORE UPDATE OF "workspaceId","bookingId","hostId" ON "BookingOccupancy"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId" AND b."hostId"=NEW."hostId")
BEGIN SELECT RAISE(ABORT,'occupancy workspace mismatch'); END;

CREATE TRIGGER "IntegrationOutbox_workspace_guard_update" BEFORE UPDATE OF "workspaceId","bookingId" ON "IntegrationOutbox"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=NEW."bookingId" AND b."workspaceId"=NEW."workspaceId")
BEGIN SELECT RAISE(ABORT,'outbox workspace mismatch'); END;

CREATE TRIGGER "OAuthConnection_workspace_guard_update" BEFORE UPDATE OF "workspaceId","userId" ON "OAuthConnection"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'oauth workspace mismatch'); END;

CREATE TRIGGER "OAuthState_workspace_guard_update" BEFORE UPDATE OF "workspaceId","userId","authSessionId" ON "OAuthState"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NEW."authSessionId" IS NULL OR NOT EXISTS (SELECT 1 FROM "AuthSession" s WHERE s."id"=NEW."authSessionId" AND s."activeWorkspaceId"=NEW."workspaceId" AND s."userId"=NEW."userId" AND s."revokedAt" IS NULL)
BEGIN SELECT RAISE(ABORT,'oauth state workspace mismatch'); END;

CREATE TRIGGER "WorkspaceInvitation_workspace_guard_insert" BEFORE INSERT ON "WorkspaceInvitation"
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."invitedById" AND m."role" IN ('OWNER','ADMIN') AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'invitation workspace mismatch'); END;

CREATE TRIGGER "WorkspaceInvitation_workspace_guard_update" BEFORE UPDATE OF "workspaceId","invitedById" ON "WorkspaceInvitation"
FOR EACH ROW WHEN NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."invitedById" AND m."role" IN ('OWNER','ADMIN') AND m."status"='ACTIVE')
BEGIN SELECT RAISE(ABORT,'invitation workspace mismatch'); END;
