-- Abort an upgrade if any pre-workspace row was orphaned, ambiguous, or crossed a tenant boundary.
CREATE TEMP TABLE "_workspace_lineage_proof" ("failures" INTEGER NOT NULL CHECK ("failures"=0));
INSERT INTO "_workspace_lineage_proof" SELECT
  (SELECT count(*) FROM "Workspace" w WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=w."id" AND m."role"='OWNER' AND m."status"='ACTIVE')) +
  (SELECT count(*) FROM "EventType" e WHERE e."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=e."workspaceId" AND m."userId"=e."ownerId" AND m."status"='ACTIVE')) +
  (SELECT count(*) FROM "AvailabilitySchedule" a WHERE a."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=a."workspaceId" AND m."userId"=a."userId" AND m."status"='ACTIVE')) +
  (SELECT count(*) FROM "AvailabilityOverride" a WHERE a."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=a."workspaceId" AND m."userId"=a."userId" AND m."status"='ACTIVE')) +
  (SELECT count(*) FROM "WorkspaceBranding" b WHERE b."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=b."workspaceId" AND m."userId"=b."userId" AND m."status"='ACTIVE')) +
  (SELECT count(*) FROM "Booking" b WHERE b."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "EventType" e JOIN "Membership" m ON m."workspaceId"=e."workspaceId" AND m."userId"=b."hostId" AND m."status"='ACTIVE' WHERE e."id"=b."eventTypeId" AND e."workspaceId"=b."workspaceId")) +
  (SELECT count(*) FROM "BookingOccupancy" o WHERE o."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=o."bookingId" AND b."workspaceId"=o."workspaceId" AND b."hostId"=o."hostId")) +
  (SELECT count(*) FROM "IntegrationOutbox" o WHERE o."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."id"=o."bookingId" AND b."workspaceId"=o."workspaceId")) +
  (SELECT count(*) FROM "AuthSession" s WHERE s."activeWorkspaceId" IS NULL OR s."membershipId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."id"=s."membershipId" AND m."workspaceId"=s."activeWorkspaceId" AND m."userId"=s."userId")) +
  (SELECT count(*) FROM "OAuthState" o WHERE o."workspaceId" IS NULL OR o."authSessionId" IS NULL OR NOT EXISTS (SELECT 1 FROM "AuthSession" s WHERE s."id"=o."authSessionId" AND s."activeWorkspaceId"=o."workspaceId" AND s."userId"=o."userId")) +
  (SELECT count(*) FROM "OAuthConnection" o WHERE o."workspaceId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."workspaceId"=o."workspaceId" AND m."userId"=o."userId" AND m."status"='ACTIVE'));
DROP TABLE "_workspace_lineage_proof";
