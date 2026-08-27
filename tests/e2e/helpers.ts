import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const baseURL = process.env.NEXT_PUBLIC_APP_URL!;
export const organizerEmail = process.env.PLAYWRIGHT_ORGANIZER_EMAIL!;
export const organizerPassword = process.env.PLAYWRIGHT_ORGANIZER_PASSWORD!;
export const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
let organizerSessionCookie: string | undefined;
// Playwright may recycle worker index zero across project processes. The OS PID
// remains distinct, so each isolated worker process receives its own bounded
// synthetic loopback limiter identity without trusting test-controlled input.
const workerAddress = `127.2.${Math.floor(process.pid / 250) % 250}.${(process.pid % 250) + 1}`;

function actionToken(purpose: string, id: string, binding: string) {
  const signature = createHmac("sha256", process.env.EMAIL_TOKEN_SECRET!).update(`token:v1\0${purpose}\0${id}\0${binding}`).digest("base64url");
  return `v1.${id}.${signature}`;
}

async function waitForAuthority<T>(read: () => Promise<T | null>, label: string) {
  const deadline = Date.now() + 5_000;
  do {
    const row = await read();
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`${label} was not committed within the bounded wait.`);
}

export async function latestAccountToken(email: string, purpose: "EMAIL_VERIFY" | "PASSWORD_RESET") {
  const row = await waitForAuthority(
    () => db.accountActionToken.findFirst({ where: { email: email.toLowerCase(), purpose, revokedAt: null, consumedAt: null }, orderBy: { createdAt: "desc" } }),
    `${purpose} authority`,
  );
  return actionToken(purpose, row.id, `${row.workspaceId}\0${row.userId}\0${row.email}`);
}

export async function latestInvitationToken(email: string) {
  const row = await waitForAuthority(
    () => db.workspaceInvitation.findFirst({ where: { email: email.toLowerCase(), status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    "workspace invitation authority",
  );
  return actionToken("WORKSPACE_INVITATION", row.id, `${row.workspaceId}\0${row.email}\0${row.role}\0${row.tokenVersion}`);
}

export async function latestBookingRecoveryToken(bookingId: string) {
  const row = await waitForAuthority(
    () => db.bookingRecoveryToken.findFirst({ where: { bookingId, revokedAt: null, consumedAt: null }, orderBy: { createdAt: "desc" } }),
    "booking recovery authority",
  );
  return actionToken("BOOKING_RECOVERY", row.id, `${row.workspaceId}\0${row.bookingId}\0${row.email}`);
}

export async function untracedJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseURL}${path}`, { ...init, headers: { Origin: baseURL, "content-type": "application/json", "x-tempocove-proxy-secret": process.env.PROXY_SHARED_SECRET!, "x-forwarded-for": workerAddress, ...init.headers } });
  if (!response.ok) {
    const safe = await response.clone().json().catch(() => ({})) as { error?: { code?: string; message?: string; fieldErrors?: Record<string, unknown> } };
    const fields = Object.keys(safe.error?.fieldErrors || {}).sort().join(",") || "none";
    throw new Error(`Untraced test transition failed with status ${response.status} (${safe.error?.code || "UNKNOWN"}; fields=${fields}; message=${safe.error?.message || "none"}).`);
  }
  return response;
}

export async function login(page: Page, email = organizerEmail, password = organizerPassword) {
  if (email === organizerEmail && password === organizerPassword) {
    await attachSession(page.context(), email, password);
    await page.goto("/dashboard");
    await expect(page.locator(".app-shell")).toBeVisible();
    return;
  }
  await page.goto("/dashboard");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".app-shell, .onboarding-page").first()).toBeVisible();
  await expect(page).toHaveURL(/\/(dashboard|onboarding)$/);
}

export async function attachSession(context: BrowserContext, email: string, password: string) {
  if (email === organizerEmail && password === organizerPassword && organizerSessionCookie) {
    await attachSetCookie(context, organizerSessionCookie);
    return organizerSessionCookie;
  }
  const response = await untracedJson("/api/auth/session", { method: "POST", body: JSON.stringify({ email, password }) });
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Session cookie was not issued.");
  if (email === organizerEmail && password === organizerPassword) organizerSessionCookie = cookie;
  const pair = cookie.split(";", 1)[0]!; const separator = pair.indexOf("=");
  await context.addCookies([{ name: pair.slice(0, separator), value: pair.slice(separator + 1), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  return cookie;
}

async function attachSetCookie(context: BrowserContext, cookie: string) {
  const pair = cookie.split(";", 1)[0]!; const separator = pair.indexOf("=");
  await context.addCookies([{ name: pair.slice(0, separator), value: pair.slice(separator + 1), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  return pair;
}

export async function createManagedBooking(context: BrowserContext, label: string) {
  const eventResponse = await fetch(`${baseURL}/api/public/strategy-call`); const eventBody = await eventResponse.json() as { data: { durations: Array<{ id: string }> } }; const durationId = eventBody.data.durations[0]!.id;
  const from = new Date(); const to = new Date(from.getTime() + 21 * 86_400_000);
  const slotsResponse = await fetch(`${baseURL}/api/public/strategy-call/slots?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&timeZone=${encodeURIComponent("America/Chicago")}&durationId=${encodeURIComponent(durationId)}`);
  const slotsBody = await slotsResponse.json() as { data: Array<{ start: string }> }; const slot = slotsBody.data[0]; if (!slot) throw new Error("No deterministic E2E slot was available.");
  const bookingResponse = await untracedJson("/api/public/strategy-call/bookings", { method: "POST", headers: { "idempotency-key": `e2e-booking-${label}` }, body: JSON.stringify({ startAt: slot.start, inviteeName: `Invitee ${label}`, inviteeEmail: `invitee-${label}@example.com`, inviteeTimeZone: "America/Chicago", durationId }) });
  const result = (await bookingResponse.json() as { data: { bookingId: string; manageSessionEstablished: boolean; manageCapabilities: null } }).data;
  if (!result.manageSessionEstablished || result.manageCapabilities !== null) throw new Error("Public booking did not establish the server-side manage session contract.");
  const setCookie = bookingResponse.headers.get("set-cookie"); if (!setCookie) throw new Error("Manage session cookie was not issued.");
  const cookie = await attachSetCookie(context, setCookie);
  const ack = await untracedJson(`/api/bookings/${result.bookingId}/manage-session`, { method: "PATCH", headers: { Cookie: cookie }, body: "{}" }); if (!ack.ok) throw new Error("Manage session acknowledgement failed.");
  return { id: result.bookingId, startAt: slot.start, durationId, cookie };
}

export async function clearBrowserState(context: BrowserContext, page: Page) {
  await context.clearCookies();
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    for (const name of await indexedDB.databases()) if (name.name) indexedDB.deleteDatabase(name.name);
    for (const key of await caches.keys()) await caches.delete(key);
  });
}

export async function assertNoClientSecretState(context: BrowserContext, page: Page) {
  expect(page.url()).not.toMatch(/[?#&](token|recovery|read|cancel|reschedule)=/i);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toMatch(/v1\.[A-Za-z0-9_-]{10,}|password|authorization|cookie/i);
  for (const cookie of await context.cookies()) expect(cookie.httpOnly, `${cookie.name} must be HttpOnly`).toBe(true);
}

export async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
