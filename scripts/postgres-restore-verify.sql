\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_setting('server_version_num')::int < 180000 THEN RAISE EXCEPTION 'PostgreSQL 18 required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='membership_last_owner_guard' AND NOT tgisinternal) THEN RAISE EXCEPTION 'last-owner guard missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='email_outbox_snapshot_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'outbox immutability guard missing'; END IF;
  IF EXISTS (SELECT 1 FROM "Booking" b LEFT JOIN "EventType" e ON e.id=b."eventTypeId" AND e."workspaceId"=b."workspaceId" WHERE e.id IS NULL) THEN RAISE EXCEPTION 'cross-workspace booking found'; END IF;
  IF EXISTS (SELECT 1 FROM "IntegrationOutbox" o LEFT JOIN "Booking" b ON b.id=o."bookingId" AND b."workspaceId"=o."workspaceId" WHERE b.id IS NULL) THEN RAISE EXCEPTION 'cross-workspace outbox found'; END IF;
END $$;
SELECT json_build_object('users',(SELECT count(*) FROM "User"),'workspaces',(SELECT count(*) FROM "Workspace"),'bookings',(SELECT count(*) FROM "Booking"),'outbox',(SELECT count(*) FROM "IntegrationOutbox"),'email_outbox',(SELECT count(*) FROM "EmailOutbox")) AS reconciliation;
