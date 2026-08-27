-- A direct membership delete or user cascade may not remove the final active owner.
-- A deliberate Workspace delete remains possible because its parent row is gone before child cascades run.
CREATE TRIGGER "Membership_last_owner_delete" BEFORE DELETE ON "Membership"
FOR EACH ROW WHEN OLD."role"='OWNER' AND OLD."status"='ACTIVE'
  AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id"=OLD."workspaceId")
  AND (SELECT count(*) FROM "Membership" WHERE "workspaceId"=OLD."workspaceId" AND "role"='OWNER' AND "status"='ACTIVE') <= 1
BEGIN SELECT RAISE(ABORT,'workspace requires an active owner'); END;
