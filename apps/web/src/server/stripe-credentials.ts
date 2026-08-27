export type StripeSecretKeyKind = "standard_test" | "claimable_sandbox" | "live" | "invalid";

export function classifyStripeSecretKey(secretKey?: string): StripeSecretKeyKind {
  if (secretKey?.startsWith("sk_test_")) return "standard_test";
  if (secretKey?.startsWith("rkcs_")) return "claimable_sandbox";
  if (secretKey?.startsWith("sk_live_") || secretKey?.startsWith("rk_live_")) return "live";
  return "invalid";
}

export function claimableStripeSandboxEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV !== "production" && environment.DEMO_MODE === "true" && environment.STRIPE_CLAIMABLE_SANDBOX === "true";
}

export function stripeSecretKeyAllowed(secretKey = process.env.STRIPE_SECRET_KEY, environment: NodeJS.ProcessEnv = process.env) {
  const kind = classifyStripeSecretKey(secretKey);
  return kind === "standard_test" || (kind === "claimable_sandbox" && claimableStripeSandboxEnabled(environment));
}

export function stripeCredentialSetReady(secretKey = process.env.STRIPE_SECRET_KEY, requireWebhook = true, environment: NodeJS.ProcessEnv = process.env) {
  const kind = classifyStripeSecretKey(secretKey);
  if (!stripeSecretKeyAllowed(secretKey, environment)) return false;
  if (kind === "claimable_sandbox" && (!environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_") || !environment.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))) return false;
  return !requireWebhook || Boolean(environment.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"));
}

export function stripeTestConfigurationReady(requireWebhook = true, environment: NodeJS.ProcessEnv = process.env) {
  return environment.PAYMENTS_PROVIDER === "stripe" && stripeCredentialSetReady(environment.STRIPE_SECRET_KEY, requireWebhook, environment);
}
