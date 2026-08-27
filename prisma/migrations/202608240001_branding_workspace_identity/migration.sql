UPDATE "Workspace"
SET "name" = (
  SELECT b."workspaceName"
  FROM "WorkspaceBranding" b
  WHERE b."workspaceId" = "Workspace"."id"
)
WHERE EXISTS (
  SELECT 1
  FROM "WorkspaceBranding" b
  WHERE b."workspaceId" = "Workspace"."id"
    AND b."workspaceName" <> "Workspace"."name"
);
