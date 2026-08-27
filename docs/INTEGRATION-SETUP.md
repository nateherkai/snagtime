# Integration setup

SnagTime works locally without external credentials. Enable integrations only after the local booking flow works.

## Google Calendar

### 1. Create a Google OAuth application

In Google Cloud Console:

1. Create or select a project.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen.
4. Create an OAuth client with application type **Web application**.
5. Add your exact callback URL as an authorized redirect URI.

Local callback:

```text
http://localhost:3000/api/integrations/google/callback
```

Hosted callback:

```text
https://your-domain.example/api/integrations/google/callback
```

The scheme, host, port, and path must match exactly. If the OAuth app is in testing mode, add the organizer account as a test user.

### 2. Configure SnagTime

Set these values in `.env.local` for local development or in your host's secret manager for deployment:

```dotenv
CALENDAR_PROVIDER="google"
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_CALENDAR_ID="primary"
```

Restart SnagTime, sign in, open `/integrations`, and select **Connect Google Calendar**.

SnagTime requests:

- `openid`
- `email`
- `https://www.googleapis.com/auth/calendar.freebusy`
- `https://www.googleapis.com/auth/calendar.events`

Verify the integration status reports complete, create a test booking, confirm the event appears on the organizer calendar, then reschedule and cancel it.

## Transactional email

Google Calendar invitations are sent by Google from the connected calendar. SnagTime's organizer notifications, invitee confirmations, workspace invitations, verification messages, and recovery messages use your SMTP provider.

Configure:

```dotenv
EMAIL_PROVIDER="smtp"
EMAIL_TOKEN_SECRET="replace-with-32-byte-random-secret"
SMTP_HOST="smtp.your-provider.example"
SMTP_PORT="587"
SMTP_TLS_MODE="starttls"
SMTP_USER="your-smtp-user"
SMTP_PASSWORD="your-smtp-password"
EMAIL_FROM="SnagTime <notifications@your-domain.example>"
EMAIL_REPLY_TO="support@your-domain.example"
EMAIL_SENDER_DOMAIN="your-domain.example"
```

Use `SMTP_TLS_MODE="implicit"` for providers that require implicit TLS, commonly on port 465. The address inside `EMAIL_FROM` must use the exact `EMAIL_SENDER_DOMAIN`.

Before public use:

1. Verify the sender with your SMTP provider.
2. Publish SPF and DKIM records.
3. Publish a DMARC policy.
4. Book from an unrelated mailbox.
5. Confirm both organizer and invitee messages arrive outside spam.

## Stripe test payments

This release accepts Stripe test-mode credentials only. Live keys and live webhook events are rejected.

Configure:

```dotenv
PAYMENTS_PROVIDER="stripe"
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

Local webhook forwarding:

```bash
stripe login
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

Copy the signing secret printed by Stripe CLI into `STRIPE_WEBHOOK_SECRET`, restart SnagTime, and create an event duration with a nonzero test price.

For a hosted deployment, create a Stripe webhook endpoint at:

```text
https://your-domain.example/api/webhooks/stripe
```

Subscribe it to:

- `checkout.session.completed`
- `checkout.session.expired`
- `refund.created`
- `refund.updated`
- `refund.failed`

Verify a Stripe test card confirms a paid booking and that cancelling a confirmed test payment creates the expected refund state.

### Optional Stripe CLI claimable sandbox

The repository can import a Stripe CLI claimable-sandbox profile into the ignored `.env.stripe-sandbox.local` without printing its credential values:

```powershell
npm run stripe:sandbox:import -- -Profile snagtime-qa
npm run dev:stripe-sandbox
```

If an expired profile cannot be repopulated, create the replacement in a fresh temporary Stripe configuration and pass that exact configuration to every command:

```powershell
$freshStripeConfig = Join-Path ([IO.Path]::GetTempPath()) 'snagtime-stripe-rotated.toml'
stripe sandbox create --project-name snagtime-qa-rotated --config $freshStripeConfig
npm run stripe:sandbox:import -- -Profile snagtime-qa-rotated -ConfigPath $freshStripeConfig
stripe listen --project-name snagtime-qa-rotated --config $freshStripeConfig --forward-to http://localhost:3000/api/webhooks/stripe
```

Delete the temporary Stripe configuration when the sandbox is no longer needed. Never commit it or `.env.stripe-sandbox.local`.

## Public URL

Set the canonical origin without a path, query, or fragment:

```dotenv
NEXT_PUBLIC_APP_URL="https://your-domain.example"
```

Update both Google and Stripe callback settings whenever the canonical domain changes.
