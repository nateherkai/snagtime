# Set up SnagTime with Codex or Claude Code

This guide lets an AI coding assistant perform the technical setup while you retain control of accounts, credentials, billing, and deployment decisions.

Start with the free local demo. It needs no Google, Stripe, SMTP, hosting, or PostgreSQL credentials. Add integrations only after the local booking journey works.

## Copy this prompt

Paste the following prompt into Codex or Claude Code. If the assistant is not already inside a clone of the repository, include `https://github.com/nateherkai/snagtime` with the prompt.

```text
Set up SnagTime for me from https://github.com/nateherkai/snagtime.

Read README.md, docs/AI-SETUP.md, docs/INTEGRATION-SETUP.md, docs/DEPLOYMENT.md, and SECURITY.md before making changes.

Begin with the credential-free local demo. Confirm that Git, Node.js 20.9 or newer, and npm are available. Clone the repository if needed, run the supported setup flow, validate it with npm run setup:check, prepare the SQLite database, and start the app. Tell me the local URL and where the generated login was shown. Verify that the health endpoint and sign-in page load.

Security rules:
- Never print, summarize, transmit, or commit .env.local or any credential value.
- Never ask me to paste secrets into chat. Tell me the exact environment variable name and let me enter the value directly into .env.local or my host's secret manager.
- Never invent provider credentials or weaken validation to make setup pass.
- Never enable Stripe live mode. This release supports Stripe test mode only.
- Never run database reset, delete data, expose the app publicly, purchase a service, or create cloud resources without my explicit approval.

After the free local demo works, ask which optional step I want: Google Calendar, SMTP email, Stripe test payments, or public deployment. Handle only the option I select.

When a provider requires a human action, pause and give me:
1. The provider page I need to open.
2. The exact setting or credential I need to create.
3. The exact callback or webhook URL to enter.
4. The environment variable name where the value belongs.
5. A safe verification step that does not reveal the value.

Wait for me to confirm each human checkpoint, then continue. At the end, report what works, what remains local-only, which integrations are enabled, and any ongoing hosting costs or operational responsibilities.
```

## What the assistant should ask first

The assistant needs only a few non-secret choices for the local setup:

1. Where should the repository be cloned?
2. What organizer email should the local demo use?
3. Should setup generate a strong demo password, or will you provide one directly at the terminal?

The assistant should not request Google, Stripe, SMTP, database, or hosting credentials before the free local booking flow works.

## Local setup checkpoints

### 1. Prerequisites

The assistant should verify:

```bash
git --version
node --version
npm --version
```

Node.js 24 is the verified runtime. Node.js 20.9 or newer is supported.

### 2. Create the local configuration

From the repository root:

```bash
npm run setup -- --email you@example.com
```

The command creates the ignored `.env.local`, generates independent application secrets, and prints the generated local password once. Save that password in your password manager.

If `.env.local` already exists, the assistant must preserve it. It must not use `--force` unless you explicitly approve replacing the file.

### 3. Validate without revealing secrets

```bash
npm run setup:check
```

A successful result says the SnagTime free-demo preflight passed. The command validates required values and secret strength without printing configured values.

### 4. Prepare and start the app

```bash
npm run demo:free
```

This installs dependencies, generates the SQLite client, applies migrations, seeds the organizer account, and starts SnagTime at [http://localhost:3000](http://localhost:3000).

The assistant should verify:

- `http://localhost:3000/api/health/live` returns a successful response.
- The sign-in page loads.
- The generated organizer login works.
- A public booking link can be created and opened.

The local inbox, local calendar adapter, and payment stub are intentional. They make the first setup free and credential-free.

## Human checkpoints for optional integrations

### Google Calendar

You must sign in to Google Cloud, create or select a project, enable the Google Calendar API, configure the OAuth consent screen, and create a web OAuth client. The assistant can explain every field and validate the callback URL, but you must control the Google account and consent flow.

Follow [Google Calendar setup](INTEGRATION-SETUP.md#google-calendar).

### Transactional email

You must choose an SMTP provider, verify a sender domain, and create provider credentials. The assistant can place the variable names and verify configuration shape, but it cannot guarantee deliverability or complete DNS ownership checks for you.

Follow [transactional email setup](INTEGRATION-SETUP.md#transactional-email).

### Stripe test payments

You must sign in to Stripe, use test mode, obtain test credentials, and create a test webhook or run Stripe CLI locally. This release rejects Stripe live keys and live webhook events.

Follow [Stripe test payments](INTEGRATION-SETUP.md#stripe-test-payments).

### Public deployment

Public deployment is an advanced self-hosting task. It requires a Linux or compatible container host, HTTPS, PostgreSQL 18 with persistent storage and verified TLS, separate web and worker services, secrets, backups, and monitoring.

ChatGPT Sites is not compatible. Vercel is not supported out of the box. Do not let an assistant select or purchase infrastructure without showing you the architecture and estimated recurring costs first.

Follow the [Deployment guide](DEPLOYMENT.md).

## Safe troubleshooting prompt

If setup fails, give the assistant this follow-up prompt:

```text
Diagnose the SnagTime setup failure using command output, tracked source files, and the documented setup contract. Do not print or read credential values. Report the failing stage, the likely cause, and the smallest safe fix. Preserve .env.local and all existing data. Do not reset the database or reinstall everything unless you first explain why and receive my approval.
```

## Definition of done

The local student setup is complete when:

- `npm run setup:check` passes.
- SnagTime opens locally and the organizer can sign in.
- The organizer can create an event type and open its public booking link.
- A test booking can be created, rescheduled, and cancelled.
- The assistant clearly labels local adapters versus connected external services.
- `.env.local` remains ignored and no credential appears in Git history or chat.

An integration is complete only after its provider-specific verification steps pass. A public deployment is complete only after HTTPS, backups, worker processing, organizer and invitee email delivery, Google free/busy behavior, and Stripe test webhooks have all been verified.
