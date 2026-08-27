import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const templateMode = args.includes("--template");
const freeMode = args.includes("--free");
const envIndex = args.indexOf("--env");
const envPath = resolve(envIndex >= 0 ? args[envIndex + 1] || "" : ".env.local");
const templateKeys = [
  "DATABASE_URL", "AUTH_SECRET", "NEXTAUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_APP_URL",
  "DEMO_MODE", "DEMO_HOST_EMAIL", "DEMO_HOST_PASSWORD", "CALENDAR_PROVIDER", "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_ENV_WORKSPACE_ID", "GOOGLE_CALENDAR_ID", "OUTBOX_WORKER_ENABLED",
  "OUTBOX_POLL_INTERVAL_MS", "PAYMENTS_PROVIDER", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_CLAIMABLE_SANDBOX",
  "EMAIL_PROVIDER", "EMAIL_TOKEN_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM", "EMAIL_REPLY_TO", "EMAIL_SENDER_DOMAIN",
];
const requiredKeys = ["DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_APP_URL", "DEMO_MODE", "DEMO_HOST_EMAIL", "DEMO_HOST_PASSWORD", "CALENDAR_PROVIDER", "OUTBOX_WORKER_ENABLED", "OUTBOX_POLL_INTERVAL_MS", "PAYMENTS_PROVIDER", "EMAIL_PROVIDER"];

function fail(messages) {
  console.error("SnagTime demo preflight failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exitCode = 1;
}

function parseEnv(text) {
  const values = new Map(); const duplicates = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!match) throw new Error("Environment file contains an invalid assignment.");
    const key = match[1]; let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (values.has(key)) duplicates.push(key); values.set(key, value);
  }
  return { values, duplicates };
}

let localParsed;
try { localParsed = parseEnv(readFileSync(envPath, "utf8")); }
catch { fail(["The selected environment file is missing or invalid."]); process.exit(); }
const values = templateMode ? localParsed.values : new Map(Object.entries(process.env).map(([key, value]) => [key, value ?? ""]));
if (!templateMode) for (const [key, value] of localParsed.values) if (!values.has(key)) values.set(key, value);
const duplicates = localParsed.duplicates.filter((key) => templateKeys.includes(key)); const errors = [];
if (duplicates.length) errors.push(`Duplicate SnagTime variables: ${[...new Set(duplicates)].sort().join(", ")}`);
const missing = (templateMode ? templateKeys : requiredKeys).filter((key) => !values.has(key)); if (missing.length) errors.push(`Missing variables: ${missing.join(", ")}`);

if (!templateMode) {
  const nodeParts = process.versions.node.split(".").map(Number); if (nodeParts[0] < 20 || (nodeParts[0] === 20 && nodeParts[1] < 9)) errors.push("Node.js 20.9 or newer is required.");
  const authSecret = values.get("AUTH_SECRET") || values.get("NEXTAUTH_SECRET") || "";
  if (Buffer.byteLength(authSecret, "utf8") < 32 || authSecret.startsWith("replace-with-")) errors.push("AUTH_SECRET or NEXTAUTH_SECRET must be a non-placeholder value of at least 32 bytes.");
  const tokenKey = values.get("TOKEN_ENCRYPTION_KEY") || "";
  if (!/^[0-9a-fA-F]{64}$/.test(tokenKey) || new Set(tokenKey.match(/../g) || []).size < 16) errors.push("TOKEN_ENCRYPTION_KEY must be 32 diverse random bytes encoded as 64 hex characters.");
  const password = values.get("DEMO_HOST_PASSWORD") || "";
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password) || password.startsWith("replace-with-")) errors.push("DEMO_HOST_PASSWORD must be a non-placeholder strong password of at least 12 characters.");
  if (values.get("DEMO_MODE") !== "true") errors.push("DEMO_MODE must equal true for the seeded local login.");
  if (!/^\S+@\S+\.\S+$/.test(values.get("DEMO_HOST_EMAIL") || "")) errors.push("DEMO_HOST_EMAIL must be an email address.");
  if (values.get("DATABASE_URL") !== "file:./dev.db") errors.push("DATABASE_URL must equal file:./dev.db for this local SQLite demo.");
  let appUrl; try { appUrl = new URL(values.get("NEXT_PUBLIC_APP_URL") || ""); } catch { errors.push("NEXT_PUBLIC_APP_URL must be a valid URL."); }
  if (appUrl && !["localhost", "127.0.0.1"].includes(appUrl.hostname)) errors.push("NEXT_PUBLIC_APP_URL must use a loopback host for the free local demo.");
  if (!["local", "google"].includes(values.get("CALENDAR_PROVIDER") || "")) errors.push("CALENDAR_PROVIDER must equal local or google.");
  if (!["stub", "stripe"].includes(values.get("PAYMENTS_PROVIDER") || "")) errors.push("PAYMENTS_PROVIDER must equal stub or stripe.");
  if (freeMode && values.get("CALENDAR_PROVIDER") !== "local") errors.push("CALENDAR_PROVIDER must equal local for the no-network free demo command.");
  if (freeMode && values.get("PAYMENTS_PROVIDER") !== "stub") errors.push("PAYMENTS_PROVIDER must equal stub for the free demo command.");
  if (!freeMode && values.get("CALENDAR_PROVIDER") === "google" && (!values.get("GOOGLE_CLIENT_ID") || !values.get("GOOGLE_CLIENT_SECRET"))) errors.push("Google mode requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  if (!freeMode && values.get("GOOGLE_REFRESH_TOKEN") && (!values.get("GOOGLE_ENV_WORKSPACE_ID") || values.get("DEMO_MODE") !== "true")) errors.push("An environment Google refresh token is local-demo-only and requires GOOGLE_ENV_WORKSPACE_ID plus DEMO_MODE=true.");
  if (!freeMode && values.get("PAYMENTS_PROVIDER") === "stripe") {
    const key = values.get("STRIPE_SECRET_KEY") || ""; const standard = key.startsWith("sk_test_");
    const sandbox = key.startsWith("rkcs_") && values.get("STRIPE_CLAIMABLE_SANDBOX") === "true" && values.get("DEMO_MODE") === "true";
    if ((!standard && !sandbox) || !values.get("STRIPE_WEBHOOK_SECRET")?.startsWith("whsec_") || (sandbox && !values.get("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")?.startsWith("pk_test_"))) errors.push("Stripe mode requires an authorized test credential, test publishable key for claimable sandbox, and webhook signing secret.");
  }
  if (values.get("OUTBOX_WORKER_ENABLED") !== "true") errors.push("OUTBOX_WORKER_ENABLED must equal true.");
  if (values.get("EMAIL_PROVIDER") !== "local") errors.push("EMAIL_PROVIDER must equal local for the credential-free demo; production SMTP is a fail-closed integration boundary.");
  const poll = Number(values.get("OUTBOX_POLL_INTERVAL_MS")); if (!Number.isInteger(poll) || poll < 1000 || poll > 60_000) errors.push("OUTBOX_POLL_INTERVAL_MS must be an integer from 1000 through 60000.");
}

if (errors.length) fail(errors);
else console.log(templateMode ? "SnagTime environment template contract is valid." : `${freeMode ? "SnagTime free-demo" : "SnagTime demo"} preflight passed against the local environment; no configured values were printed.`);
