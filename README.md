<div align="center">
  <img src="apps/web/public/snagtime-logo.svg" alt="SnagTime" width="305" />

  <p><strong>Snag a time. Get booked.</strong></p>
  <p>A free, self-hostable scheduling app for availability, booking links, calendar sync, email notifications, and test payments.</p>
</div>

## What SnagTime does

SnagTime gives you the source code for your own scheduling system. You can run it locally for free, customize it, and host it on infrastructure you control.

- Account registration, sign-in, password recovery, and email verification
- Workspaces, members, invitations, and workspace switching
- Event types with multiple durations and optional test pricing
- Weekly availability, date overrides, buffers, minimum notice, and booking windows
- Public booking links with time-zone handling and custom questions
- Booking confirmation, rescheduling, cancellation, and recovery links
- Google Calendar free/busy checks and event creation
- Stripe Checkout in test mode, including webhook confirmation and refund handling
- SMTP email for organizers and invitees
- Custom workspace branding, accent colors, profile images, and uploaded logos
- SQLite for the local demo and a hardened PostgreSQL production architecture

## Five-minute local setup

### Requirements

- Node.js 20.9 or newer. Node.js 24 is the verified runtime.
- npm
- Git

### 1. Clone and enter the repository

```bash
git clone https://github.com/nateherkai/snagtime.git
cd snagtime
```

### 2. Generate your local configuration

```bash
npm run setup
```

The setup command creates an ignored `.env.local`, generates independent cryptographic secrets, and prints the local demo login once. You can provide your own organizer login instead:

```bash
npm run setup -- --email you@example.com --password "YourStrong!Password7"
```

### 3. Install, prepare the database, and start SnagTime

```bash
npm run demo:free
```

Open [http://localhost:3000](http://localhost:3000) and use the login printed by the setup command.

The credential-free local mode uses SQLite, a local calendar adapter, a local email inbox, and stub payments. It does not call Google or Stripe.

## Connect your services

Copying the repository gives you all of the software. External integrations still belong to you and must be configured with your own accounts.

| Capability | What you provide | Required for local demo? |
|---|---|---:|
| Database | Nothing for SQLite, PostgreSQL for production | No |
| Public hosting | HTTPS domain plus a long-running Node web service and worker | No |
| Google Calendar | OAuth client ID and client secret | No |
| Transactional email | SMTP host, user, password, and verified sender domain | No |
| Stripe payments | Stripe test secret, publishable key, and webhook secret | No |

See [Integration setup](docs/INTEGRATION-SETUP.md) for exact callback URLs, environment variables, and verification steps.

## Put it on the internet

SnagTime is a dynamic application, not a static website. It needs server-side Node.js execution, a persistent database, webhook endpoints, and a continuously running background worker.

- ChatGPT Sites is not a compatible production host for this repository.
- Vercel is not supported out of the box because the current production design requires a long-running worker and PostgreSQL runtime roles.
- A Linux VPS or a container platform that supports a web service, a worker service, persistent PostgreSQL, secrets, and HTTPS is the right shape.

The full production architecture is intentionally strict. It uses PostgreSQL 18, forced row-level security, separate app and worker credentials, verified database TLS, and authenticated proxy ingress. Read [Deployment guide](docs/DEPLOYMENT.md) before choosing a host.

## What is actually free?

The SnagTime source code is free under the MIT License. Running it locally can also cost nothing.

A public deployment can still create third-party costs:

- Hosting or a VPS
- A domain name
- Managed PostgreSQL, if your host does not include it
- Transactional email volume
- Provider fees for any services you connect

Google OAuth credentials can be created without paying SnagTime. Stripe test mode is free for testing. This release deliberately rejects Stripe live-mode keys, so do not advertise it as a live payment processor without implementing and auditing live-mode support.

## Useful commands

```bash
npm run setup          # Create .env.local and local credentials
npm run demo:free      # Install, migrate, seed, and run the free local demo
npm run dev            # Run the configured local development server
npm run test           # Run the unit and contract test suite
npm run typecheck      # Check TypeScript
npm run lint           # Run ESLint
npm run build          # Create the Next.js production build
npm run ci:secret-scan # Scan public source files for credential patterns
```

Database commands:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

`npm run db:reset` destroys the local SQLite database. Use it only when you intentionally want a clean demo.

## Project structure

```text
apps/web/             Next.js application and API routes
apps/web/public/      SnagTime logo and icon
prisma/               SQLite schema, PostgreSQL schema, and migrations
scripts/              Setup, database, worker, security, and verification tools
infrastructure/       PostgreSQL container hardening
tests/                Browser and end-to-end tests
docs/                 Setup, deployment, and brand documentation
```

## Project status

The local SQLite experience and integration test paths are designed for demos, development, and personal experimentation. The production architecture is an advanced self-hosting path, not a one-click managed service. You are responsible for infrastructure security, backups, provider configuration, deliverability, compliance, and ongoing operations.

Please read [Security](SECURITY.md) before exposing a deployment publicly.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

SnagTime is available under the [MIT License](LICENSE).
