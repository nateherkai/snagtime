# Security policy

## Supported release

The current `main` branch receives security fixes. This open-source release is self-hosted software, so deployers remain responsible for operating-system updates, database security, backups, HTTPS, provider settings, sender-domain authentication, logs, and incident response.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature on this repository when available. Do not place credentials, personal data, exploit details, or live deployment URLs in a public issue.

If private reporting is unavailable, open a public issue containing only a request for a private security contact. Do not include the vulnerability details in that issue.

## Deployment rules

- Never commit `.env`, `.env.local`, `.env.*.local`, database files, OAuth tokens, API keys, or secret mounts.
- Use HTTPS for every public deployment.
- Use independent random secrets. Do not reuse the authentication secret for capability signing, encryption, rate limiting, proxy authentication, or email tokens.
- Keep Google OAuth tokens encrypted at rest with a stable `TOKEN_ENCRYPTION_KEY`.
- Verify SPF, DKIM, and DMARC before relying on SMTP delivery.
- Keep Stripe in test mode unless live support has been separately implemented and audited.
- Back up PostgreSQL and perform restore drills before treating a deployment as production-ready.
- Review dependency and container alerts continuously after deployment.

The repository includes `npm run ci:secret-scan`, but automated scanning is not a substitute for reviewing every file and commit before publishing.
