-- CouncilForge identity handoff. This file is appended to the isolated
-- SnagTime schema migration and runs inside the existing CouncilForge PG18.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "councilForgeUserId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_councilForgeUserId_key" ON "User"("councilForgeUserId");
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "councilForgeCompanyId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "councilForgeEdgeId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_councilForgeCompanyId_key" ON "Workspace"("councilForgeCompanyId");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_councilForgeEdgeId_key" ON "Workspace"("councilForgeEdgeId");

CREATE TABLE IF NOT EXISTS "CouncilForgeSsoReplay" (
  jti TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CouncilForgeSsoReplay_expiresAt_idx" ON "CouncilForgeSsoReplay"("expiresAt");
ALTER TABLE "CouncilForgeSsoReplay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CouncilForgeSsoReplay" FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON "CouncilForgeSsoReplay" TO tempocove_app;

DROP POLICY IF EXISTS app_federated_user_read ON "User";
CREATE POLICY app_federated_user_read ON "User" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('federated') AND id=current_setting('tempocove.user_id',true)
);
DROP POLICY IF EXISTS app_federated_workspace_read ON "Workspace";
CREATE POLICY app_federated_workspace_read ON "Workspace" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('federated') AND id=current_setting('tempocove.workspace_id',true)
);
DROP POLICY IF EXISTS app_federated_membership_read ON "Membership";
CREATE POLICY app_federated_membership_read ON "Membership" FOR SELECT TO tempocove_app USING (
  tempocove_context_valid('federated') AND "userId"=current_setting('tempocove.user_id',true)
    AND "workspaceId"=current_setting('tempocove.workspace_id',true) AND status='ACTIVE'
);

CREATE OR REPLACE FUNCTION tempocove_councilforge_sso_bootstrap(
  p_jti text,
  p_expires_at timestamptz,
  p_user_id text,
  p_councilforge_user_id text,
  p_workspace_id text,
  p_councilforge_company_id text,
  p_edge_company_id text,
  p_company_name text,
  p_profile_json text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,snagtime,public
AS $fn$
DECLARE
  profile jsonb;
  normalized_email text;
  display_name text;
  workspace_role text;
  membership_id text;
BEGIN
  IF NOT tempocove_context_valid('federated')
     OR current_setting('tempocove.action',true)<>'councilforge_sso'
     OR current_setting('tempocove.subject',true)<>p_jti
     OR current_setting('tempocove.user_id',true)<>p_user_id
     OR current_setting('tempocove.workspace_id',true)<>p_workspace_id
     OR p_jti='' OR p_expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'invalid CouncilForge SSO context' USING ERRCODE='28000'; END IF;

  profile := p_profile_json::jsonb;
  normalized_email := lower(trim(profile->>'email'));
  display_name := trim(profile->>'name');
  workspace_role := profile->>'role';
  IF normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR display_name='' OR workspace_role NOT IN ('OWNER','ADMIN','MEMBER')
     OR p_councilforge_user_id='' OR p_councilforge_company_id=''
     OR p_edge_company_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
  THEN RAISE EXCEPTION 'invalid CouncilForge SSO identity' USING ERRCODE='22023'; END IF;

  DELETE FROM "CouncilForgeSsoReplay" WHERE "expiresAt"<clock_timestamp();
  INSERT INTO "CouncilForgeSsoReplay"(jti,"expiresAt") VALUES(p_jti,p_expires_at);

  INSERT INTO "User"(id,"councilForgeUserId",email,name,"passwordHash","emailVerifiedAt","createdAt","updatedAt")
  VALUES(p_user_id,p_councilforge_user_id,normalized_email,display_name,'councilforge-sso-only',clock_timestamp(),clock_timestamp(),clock_timestamp())
  ON CONFLICT(id) DO UPDATE SET
    "councilForgeUserId"=EXCLUDED."councilForgeUserId",email=EXCLUDED.email,name=EXCLUDED.name,
    "emailVerifiedAt"=clock_timestamp(),"updatedAt"=clock_timestamp()
  WHERE "User"."councilForgeUserId"=EXCLUDED."councilForgeUserId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CouncilForge user identity collision' USING ERRCODE='23505'; END IF;

  INSERT INTO "Workspace"(id,"councilForgeCompanyId","councilForgeEdgeId",name,"onboardingCompletedAt","createdAt","updatedAt")
  VALUES(p_workspace_id,p_councilforge_company_id,p_edge_company_id,p_company_name,clock_timestamp(),clock_timestamp(),clock_timestamp())
  ON CONFLICT(id) DO UPDATE SET
    "councilForgeCompanyId"=EXCLUDED."councilForgeCompanyId","councilForgeEdgeId"=EXCLUDED."councilForgeEdgeId",
    name=EXCLUDED.name,"onboardingCompletedAt"=COALESCE("Workspace"."onboardingCompletedAt",clock_timestamp()),"updatedAt"=clock_timestamp()
  WHERE "Workspace"."councilForgeCompanyId"=EXCLUDED."councilForgeCompanyId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CouncilForge company identity collision' USING ERRCODE='23505'; END IF;

  membership_id := 'cfm_'||substr(encode(digest(convert_to(p_user_id||':'||p_workspace_id,'UTF8'),'sha256'),'hex'),1,32);
  INSERT INTO "Membership"(id,"workspaceId","userId",role,status,"createdAt","updatedAt")
  VALUES(membership_id,p_workspace_id,p_user_id,workspace_role,'ACTIVE',clock_timestamp(),clock_timestamp())
  ON CONFLICT("workspaceId","userId") DO UPDATE SET role=EXCLUDED.role,status='ACTIVE',"updatedAt"=clock_timestamp();

  INSERT INTO "AvailabilitySchedule"(id,"workspaceId","userId","createdAt","updatedAt")
  VALUES('cfa_'||substr(encode(digest(convert_to(p_user_id||':'||p_workspace_id,'UTF8'),'sha256'),'hex'),1,32),p_workspace_id,p_user_id,clock_timestamp(),clock_timestamp())
  ON CONFLICT("workspaceId","userId") DO NOTHING;
  RETURN membership_id;
END $fn$;

REVOKE ALL ON FUNCTION tempocove_councilforge_sso_bootstrap(text,timestamptz,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tempocove_councilforge_sso_bootstrap(text,timestamptz,text,text,text,text,text,text,text) TO tempocove_app;
