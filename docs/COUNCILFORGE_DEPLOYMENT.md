# CouncilForge production deployment

SnagTime runs as two containers (`web` and `worker`) beside CouncilForge. It uses
CouncilForge's PostgreSQL 18 engine without sharing CouncilForge application
tables: every SnagTime object lives in the isolated `snagtime` schema. The
containers join the existing `councilforge-public` network for PostgreSQL and
`traefik-public` for HTTPS ingress.

## Authentication boundary

CouncilForge remains the account and company authority. The Admin Dashboard
creates a 60-second HMAC assertion containing the PostgreSQL user UUID,
PostgreSQL company UUID, edge company id, role, audience, issuer, timestamps,
and a unique `jti`. SnagTime accepts it only at
`POST /api/auth/councilforge`, consumes the `jti` once, maps the user and company
to deterministic local ids, and issues a SnagTime session. Password login,
registration, verification, reset, and password changes fail closed while
`SNAGTIME_COUNCILFORGE_ONLY=true`.

The shared HMAC secret must exist both as the Admin Dashboard Worker secret
`SNAGTIME_SSO_SECRET` and as `/opt/snagtime/secrets/snagtime_sso_secret` on the
Docker host. Never put its value in Compose, Git, logs, or shell history.

## Production layout

- Repository: `/Volumes/BackupPlus/VideoLab/repos/snagtime-v1-deploy`
- Server application: `/opt/snagtime/app`
- Server secrets: `/opt/snagtime/secrets`
- Compose project: `snagtime-production`
- Public URL: `https://snagtime.aiautomationauthority.com`
- External networks: `councilforge-public`, `traefik-public`
- Database/schema: `councilforge` / `snagtime`

Database URLs use verified TLS with the mounted CouncilForge CA, an explicit
`snagtime` search path, bounded connection pools, and connect/pool/statement
timeouts. The runtime containers are read-only, drop Linux capabilities, and
have explicit CPU and memory limits. Only the app and worker login roles are
enabled; migration and monitoring logins remain disabled unless an operator
temporarily provisions them.

The isolated migration must grant schema `USAGE` to
`tempocove_rls_verifier` and `tempocove_migration`. Without verifier access,
security-definer RLS functions cannot resolve SnagTime tables.

## Deploy and validate

Build with an immutable `BUILD_ID`, transfer the resulting application tree to
`/opt/snagtime/app`, and start only the SnagTime services:

```sh
cd /opt/snagtime/app
BUILD_ID=<immutable-id> docker compose -p snagtime-production \
  -f compose.production.yml up -d --no-build --force-recreate web worker
```

Before replacing containers, verify the CouncilForge database backup and stage
the isolated schema. After deployment, require all of these checks:

```sh
curl -fsS https://snagtime.aiautomationauthority.com/api/health/live
curl -fsS https://snagtime.aiautomationauthority.com/api/health/ready
docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' \
  snagtime-production-web-1 snagtime-production-worker-1
docker logs --tail 100 snagtime-production-web-1
docker logs --tail 100 snagtime-production-worker-1
```

Also run the signed SSO smoke and confirm:

- a valid assertion returns a session mapped to the expected user and tenant;
- replaying the same assertion is rejected;
- a modified signature is rejected;
- local password login is rejected;
- a session cannot switch to a tenant without a live membership; and
- the CouncilForge PostgreSQL and API containers remain running.

## Backup and rollback

The verified pre-conversion backup is stored at:

- Server: `/opt/snagtime/backups/20260831T120327Z`
- External copy: `/Volumes/BackupPlus/VideoLab/backups/snagtime-councilforge/20260831T120327Z`

Both copies include SHA-256 checksums, globals, container/network inspection,
and a `pg_restore --list`-verified full dump. Do not restore over the live
database merely to remove SnagTime. The normal rollback is:

1. Stop the `snagtime-production` web and worker containers.
2. Redeploy the last known-good SnagTime image if the database is compatible.
3. If the schema itself must be reversed, take a fresh incident backup first,
   then restore the verified pre-conversion dump using PostgreSQL 18 tooling.
4. Confirm CouncilForge API/database health before reopening traffic.

Dropping only the `snagtime` schema is destructive and is not part of routine
rollback. It requires a fresh backup and an explicit operator decision.

## Secret rotation

Write replacement values directly to the matching files under
`/opt/snagtime/secrets`, preserve directory/file ownership and modes, update the
Admin Dashboard Worker secret when rotating SSO, and recreate both containers.
Rotate the PostgreSQL login passwords and their URL files together. Validate a
new signed login before invalidating the previous SSO secret.

## Current provider mode

This deployment intentionally uses the internal calendar, disabled outbound
email, and stub payments. Google Calendar, SMTP delivery, and Stripe payments
are not active until the production provider credentials and operational flows
are separately enabled and tested.
