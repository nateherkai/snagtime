UPDATE "Workspace" AS w
SET name = b."workspaceName"
FROM "WorkspaceBranding" AS b
WHERE b."workspaceId" = w.id
  AND b."workspaceName" <> w.name;

DROP POLICY IF EXISTS app_workspace_update ON "Workspace";
CREATE POLICY app_workspace_update ON "Workspace" FOR UPDATE TO tempocove_app
USING (tempocove_workspace_admin(id) AND current_setting('tempocove.action',true) IN ('workspace_update','branding_write'))
WITH CHECK (tempocove_workspace_admin(id));
