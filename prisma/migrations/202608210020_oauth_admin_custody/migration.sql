-- Keep Google credential and authorization-state custody commit-bound to a live workspace administrator.
-- Stop the upgrade before installing all-column guards if predecessor data could otherwise become
-- impossible to revoke or clean up. An operator must restore administrator custody or disconnect it first.
DROP TABLE IF EXISTS temp."__oauth_admin_custody_preflight";
CREATE TEMP TABLE "__oauth_admin_custody_preflight" ("valid" INTEGER NOT NULL CHECK ("valid"=1));
INSERT INTO "__oauth_admin_custody_preflight" ("valid")
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM "OAuthConnection" c WHERE NOT EXISTS (
    SELECT 1 FROM "Membership" m WHERE m."workspaceId"=c."workspaceId" AND m."userId"=c."userId"
      AND m."status"='ACTIVE' AND m."role" IN ('OWNER','ADMIN'))
) OR EXISTS (
  SELECT 1 FROM "OAuthState" o WHERE o."consumedAt" IS NULL AND NOT EXISTS (
    SELECT 1 FROM "AuthSession" s JOIN "Membership" m ON m."id"=s."membershipId"
    WHERE s."id"=o."authSessionId" AND s."activeWorkspaceId"=o."workspaceId" AND s."userId"=o."userId" AND s."revokedAt" IS NULL
      AND m."workspaceId"=o."workspaceId" AND m."userId"=o."userId" AND m."status"='ACTIVE' AND m."role" IN ('OWNER','ADMIN'))
) THEN 0 ELSE 1 END;
DROP TABLE temp."__oauth_admin_custody_preflight";

DROP TRIGGER IF EXISTS "OAuthConnection_workspace_guard_insert";
DROP TRIGGER IF EXISTS "OAuthConnection_workspace_guard_update";
CREATE TRIGGER "OAuthConnection_workspace_guard_insert" BEFORE INSERT ON "OAuthConnection"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId"
    AND m."status"='ACTIVE' AND m."role" IN ('OWNER','ADMIN'))
BEGIN SELECT RAISE(ABORT,'oauth administrator workspace mismatch'); END;
CREATE TRIGGER "OAuthConnection_workspace_guard_update" BEFORE UPDATE ON "OAuthConnection"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "Membership" m WHERE m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId"
    AND m."status"='ACTIVE' AND m."role" IN ('OWNER','ADMIN'))
BEGIN SELECT RAISE(ABORT,'oauth administrator workspace mismatch'); END;

DROP TRIGGER IF EXISTS "OAuthState_workspace_guard_insert";
DROP TRIGGER IF EXISTS "OAuthState_workspace_guard_update";
CREATE TRIGGER "OAuthState_workspace_guard_insert" BEFORE INSERT ON "OAuthState"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NEW."authSessionId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "AuthSession" s JOIN "Membership" m ON m."id"=s."membershipId"
  WHERE s."id"=NEW."authSessionId" AND s."activeWorkspaceId"=NEW."workspaceId" AND s."userId"=NEW."userId"
    AND s."revokedAt" IS NULL
    AND m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE' AND m."role" IN ('OWNER','ADMIN'))
BEGIN SELECT RAISE(ABORT,'oauth state administrator workspace mismatch'); END;
CREATE TRIGGER "OAuthState_workspace_guard_update" BEFORE UPDATE ON "OAuthState"
FOR EACH ROW WHEN NEW."workspaceId" IS NULL OR NEW."authSessionId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "AuthSession" s JOIN "Membership" m ON m."id"=s."membershipId"
  WHERE s."id"=NEW."authSessionId" AND s."activeWorkspaceId"=NEW."workspaceId" AND s."userId"=NEW."userId"
    AND s."revokedAt" IS NULL
    AND m."workspaceId"=NEW."workspaceId" AND m."userId"=NEW."userId" AND m."status"='ACTIVE' AND m."role" IN ('OWNER','ADMIN'))
BEGIN SELECT RAISE(ABORT,'oauth state administrator workspace mismatch'); END;
