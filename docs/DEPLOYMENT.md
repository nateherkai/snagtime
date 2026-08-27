# Deployment guide

## Choose the right deployment shape

SnagTime is a stateful Next.js application with API routes, a relational database, OAuth callbacks, webhooks, and asynchronous calendar and email work.

It cannot be deployed as static files. ChatGPT Sites is not compatible with this application. Vercel is not supported out of the box because the audited production design requires a continuously running worker and role-separated PostgreSQL connections.

Use infrastructure that supports:

- A long-running Node.js web container
- A separate long-running worker container
- PostgreSQL 18 with persistent storage and verified TLS
- HTTPS ingress with a stable domain
- Runtime secret injection
- Scheduled encrypted backups

A Linux VPS with Docker is the most direct fit. Container platforms can also work if they provide all of the capabilities above, but the included production Compose file is a reference deployment contract, not a one-click template for a particular vendor.

## Local versus production

| Area | Local demo | Production contract |
|---|---|---|
| Database | SQLite | PostgreSQL 18 |
| Rate limiting | Process-local | PostgreSQL-backed |
| Background work | Embedded in web process | Dedicated worker |
| URL | `http://localhost:3000` | Canonical HTTPS origin |
| Secrets | Ignored `.env.local` | Secret manager or mounted secret files |
| Calendar | Local or Google | Google |
| Email | Local inbox or SMTP | TLS SMTP |
| Payments | Stub or Stripe test | Stripe test only |

Do not expose the local demo configuration to the public internet.

## Production components

The repository provides:

- `Dockerfile` target `runtime` for both web and worker
- `Dockerfile` target `migration` for database migrations
- `compose.production.yml` as the required service and secret topology
- `infrastructure/postgresql/` for PostgreSQL TLS and host-based access controls
- `prisma/postgresql/` for the generated schema, baseline migration, row-level security, and runtime guards
- `scripts/provision-postgres-logins.mjs` for separate migration, app, worker, and monitor credentials
- `scripts/backup-postgres.ps1` and `scripts/restore-postgres.ps1` for encrypted backup and restore workflows

Historical internal identifiers beginning with `tempocove` remain in database roles and generated artifacts for migration compatibility. They are not customer-facing branding.

## Deployment sequence

### 1. Prepare a domain and HTTPS ingress

Choose the final origin before configuring providers, for example:

```text
https://book.your-domain.example
```

Your reverse proxy must terminate HTTPS, strip any incoming proxy-authentication header from the client, inject the trusted `PROXY_SHARED_SECRET`, and forward requests to the web container.

### 2. Prepare PostgreSQL 18

Use PostgreSQL 18 with verified TLS. The production URLs must include:

```text
sslmode=verify-full
sslrootcert=/absolute/or/container/path/to/ca.crt
connect_timeout=3
pool_timeout=20
connection_limit=20
statement_timeout=2000
```

The exact app, worker, migration, and monitor URLs use different database logins. Bootstrap owner credentials must never be mounted into the web or worker container.

Generate and validate the PostgreSQL artifacts:

```bash
npm ci
npm run db:generate:postgres
npm run db:baseline:postgres
```

Provision the runtime logins from an operator-controlled environment:

```bash
npm run db:provision:postgres-logins
```

That command requires the bootstrap database URL plus independent values for:

- `TEMPOCOVE_MIGRATION_DB_PASSWORD`
- `TEMPOCOVE_APP_DB_PASSWORD`
- `TEMPOCOVE_WORKER_DB_PASSWORD`
- `TEMPOCOVE_MONITOR_DB_PASSWORD`
- `TENANT_CONTEXT_SECRET`

### 3. Create independent application secrets

Required application secrets include:

- `AUTH_SECRET`
- `BOOKING_CAPABILITY_SECRET`
- `BOOKING_CAPABILITY_KEYRING`
- `TOKEN_ENCRYPTION_KEY`, exactly 64 hexadecimal characters
- `EMAIL_TOKEN_SECRET`
- `TENANT_CONTEXT_SECRET`
- `RATE_LIMIT_HASH_SECRET`
- `PROXY_SHARED_SECRET`
- `OPERATOR_HEALTH_SECRET`
- Provider secrets for Google, Stripe test mode, and SMTP

Every secret must be independent. Store them in the platform's secret manager or mount them as files. Never bake them into an image.

### 4. Build immutable images

Use the 40-character Git commit SHA as `BUILD_ID`:

```bash
BUILD_ID=$(git rev-parse HEAD)
docker build --build-arg BUILD_ID="$BUILD_ID" --target runtime -t snagtime:"$BUILD_ID" .
docker build --target migration -t snagtime-migration:"$BUILD_ID" .
```

The runtime refuses to start when its configured `BUILD_ID` does not match the compiled build.

### 5. Run migration, web, and worker

Run the migration image with the migration database URL first. Then run two copies of the runtime image:

- Web command: `node apps/web/server.js`
- Worker command: `node dist/worker.mjs`

Use `compose.production.yml` to see the required environment split and secret mounts for each service. The file deliberately declares secrets as external, so your orchestration layer must create them before startup.

### 6. Configure providers

Follow [Integration setup](INTEGRATION-SETUP.md). The hosted callbacks use the final HTTPS origin.

### 7. Verify before sharing a booking link

At minimum:

1. Confirm `/api/health/live` responds.
2. Confirm `/api/health/ready` reports ready.
3. Register and verify a fresh account.
4. Connect Google Calendar and verify free/busy blocking.
5. Create, reschedule, and cancel a free booking.
6. Confirm organizer and invitee SMTP delivery from unrelated mailboxes.
7. Complete and refund a Stripe test booking.
8. Restart web and worker containers and verify data remains intact.
9. Run an encrypted backup and restore it into an isolated empty database.

## Platform notes

### Vercel

Not supported by this repository's current production contract. The web frontend is Next.js, but the system also needs PostgreSQL runtime roles and a dedicated continuously running worker.

### ChatGPT Sites

Not compatible. This is not a static site and needs server-side code, persistent storage, OAuth callbacks, and webhooks.

### Railway, Render, Fly.io, and similar platforms

Potentially compatible if configured as separate web and worker services with PostgreSQL, stable HTTPS, mounted secrets, and the required database TLS posture. No one-click template is included or verified in this release.

### Linux VPS with Docker

The closest match to the included architecture because you control the reverse proxy, certificates, PostgreSQL container, secret mounts, worker, and backups. It also carries the most operational responsibility.

## Operational ownership

The MIT-licensed software is free. A public service is not maintenance-free. The deployer owns:

- Hosting and domain costs
- Database capacity and backups
- Security updates and dependency alerts
- Google OAuth consent and verification requirements
- SMTP reputation, SPF, DKIM, DMARC, and deliverability
- Stripe account configuration and any future live-mode implementation
- Privacy policy, terms, data retention, and regulatory obligations
- Monitoring, incident response, and disaster recovery
