import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStripeSecretKey, stripeCredentialSetReady, stripeSecretKeyAllowed, stripeTestConfigurationReady } from "@/server/stripe-credentials";

describe("Stripe credential classification", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("classifies standard test, claimable sandbox, live, and invalid credentials without inspecting suffixes", () => {
    expect(classifyStripeSecretKey("sk_test_fixture")).toBe("standard_test");
    expect(classifyStripeSecretKey("rkcs_test_fixture")).toBe("claimable_sandbox");
    expect(classifyStripeSecretKey("sk_live_forbidden")).toBe("live");
    expect(classifyStripeSecretKey("not-a-key")).toBe("invalid");
  });

  it("accepts rkcs only with the explicit nonproduction demo sandbox gate", () => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("STRIPE_CLAIMABLE_SANDBOX", "true");
    expect(stripeSecretKeyAllowed("rkcs_test_fixture")).toBe(true);
    vi.stubEnv("STRIPE_CLAIMABLE_SANDBOX", "false"); expect(stripeSecretKeyAllowed("rkcs_test_fixture")).toBe(false);
  });

  it("rejects rkcs and every live credential in production even when demo flags are forged", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("STRIPE_CLAIMABLE_SANDBOX", "true");
    expect(stripeSecretKeyAllowed("rkcs_test_fixture")).toBe(false);
    expect(stripeSecretKeyAllowed("sk_live_forbidden")).toBe(false);
    expect(stripeSecretKeyAllowed("rk_live_forbidden")).toBe(false);
    expect(stripeSecretKeyAllowed("sk_test_fixture")).toBe(true);
  });

  it("requires the sandbox publishable key and webhook secret for configured demo status", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("STRIPE_CLAIMABLE_SANDBOX", "true"); vi.stubEnv("PAYMENTS_PROVIDER", "stripe"); vi.stubEnv("STRIPE_SECRET_KEY", "rkcs_test_fixture"); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture");
    expect(stripeTestConfigurationReady()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture"); expect(stripeTestConfigurationReady()).toBe(true);
  });

  it("requires the complete sandbox set even when only Checkout construction is requested", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DEMO_MODE", "true"); vi.stubEnv("STRIPE_CLAIMABLE_SANDBOX", "true"); vi.stubEnv("STRIPE_SECRET_KEY", "rkcs_test_fixture");
    expect(stripeCredentialSetReady(process.env.STRIPE_SECRET_KEY, false)).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture"); expect(stripeCredentialSetReady(process.env.STRIPE_SECRET_KEY, false)).toBe(false);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture"); expect(stripeCredentialSetReady(process.env.STRIPE_SECRET_KEY, false)).toBe(true);
  });

  it("keeps the standard test constructor independent of publishable and webhook fields", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(stripeCredentialSetReady("sk_test_fixture", false)).toBe(true);
    expect(stripeCredentialSetReady("sk_test_fixture", true)).toBe(false);
  });
});
