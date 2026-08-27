# Contributing to SnagTime

Thanks for helping improve SnagTime.

## Development setup

```bash
git clone https://github.com/nateherkai/snagtime.git
cd snagtime
npm run setup
npm run demo:free
```

## Before opening a pull request

Run the local verification suite:

```bash
npm ci
npm run db:generate
npm run test
npm run typecheck
npm run lint
npm run build
npm run ci:secret-scan
```

Keep pull requests focused. Include tests for behavior changes and explain any new environment variables, migrations, provider permissions, or deployment assumptions.

## Security reports

Do not open a public issue for a vulnerability or exposed credential. Follow [SECURITY.md](SECURITY.md).

## Project boundaries

- Never commit `.env.local`, provider keys, OAuth tokens, SMTP passwords, database dumps, or production URLs containing credentials.
- Keep SQLite support limited to local development and demos.
- Preserve the production fail-closed behavior for provider configuration and tenant isolation.
- Stripe live mode is outside the current audited release. Do not enable it without tests, webhook review, refund review, and updated documentation.
