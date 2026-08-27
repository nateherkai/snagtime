import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const port = Number(process.env.PLAYWRIGHT_PORT || 3210);
const baseURL = `http://127.0.0.1:${port}`;
process.env.PLAYWRIGHT_DATABASE_PATH = resolve(process.env.PLAYWRIGHT_DATABASE_PATH || resolve("runtime", "playwright", "e2e.db"));
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = `file:${process.env.PLAYWRIGHT_DATABASE_PATH.replaceAll("\\", "/")}`;
process.env.DEMO_MODE = "true";
process.env.EMAIL_PROVIDER = "local";
process.env.CALENDAR_PROVIDER = "local";
process.env.PAYMENTS_PROVIDER = "stub";
process.env.NEXT_PUBLIC_APP_URL = baseURL;
process.env.PLAYWRIGHT_ORGANIZER_EMAIL ||= "organizer.e2e@example.com";
process.env.PLAYWRIGHT_ORGANIZER_PASSWORD ||= `E2e!${randomBytes(18).toString("base64url")}`;
process.env.PLAYWRIGHT_ACCOUNT_PASSWORD ||= `Account!9${randomBytes(18).toString("base64url")}`;
process.env.PLAYWRIGHT_REPLACEMENT_PASSWORD ||= `Replacement!9${randomBytes(18).toString("base64url")}`;
process.env.AUTH_SECRET ||= randomBytes(32).toString("base64url");
process.env.EMAIL_TOKEN_SECRET ||= randomBytes(32).toString("base64url");
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
process.env.TRUST_PROXY = "true";
process.env.PROXY_SHARED_SECRET ||= randomBytes(32).toString("base64url");

function ingressHeaders(address: string) {
  return { Origin: baseURL, "x-tempocove-proxy-secret": process.env.PROXY_SHARED_SECRET!, "x-forwarded-for": address };
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["line"], ["json", { outputFile: "runtime/playwright/results.json" }]] : "line",
  outputDir: "runtime/playwright/artifacts",
  use: {
    baseURL,
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    // Auth and booking responses contain short-lived authorities. Failure traces
    // would retain request bodies/cookies, so the committed artifact contract is
    // failure-only screenshots and sanitized reporter output, never traces.
    trace: "off",
    video: "off",
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "America/Chicago",
    extraHTTPHeaders: ingressHeaders("127.0.0.99"),
  },
  webServer: {
    command: `node scripts/e2e-server.mjs --port=${port}`,
    url: `${baseURL}/api/health/live`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, extraHTTPHeaders: ingressHeaders("127.0.0.11") } },
    { name: "edge-desktop", use: { ...devices["Desktop Edge"], channel: "msedge", viewport: { width: 1440, height: 900 }, extraHTTPHeaders: ingressHeaders("127.0.0.12") } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, extraHTTPHeaders: ingressHeaders("127.0.0.13") } },
    { name: "edge-mobile", use: { ...devices["Pixel 7"], channel: "msedge", viewport: { width: 390, height: 844 }, extraHTTPHeaders: ingressHeaders("127.0.0.14") } },
  ],
});
