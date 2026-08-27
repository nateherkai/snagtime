import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { assertNoClientSecretState, assertNoHorizontalOverflow, attachSession, baseURL, createManagedBooking, db, latestAccountToken, latestInvitationToken, login, organizerEmail, organizerPassword, untracedJson } from "./helpers";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

async function scan(page: Page, state: string) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => {
    const axe = (window as typeof window & { axe: { run: (context?: unknown, options?: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[]; failureSummary: string | undefined }> }> }> } }).axe;
    return axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
  });
  expect(result.violations, `${state}: ${JSON.stringify(result.violations)}`).toEqual([]);
  await assertNoHorizontalOverflow(page);
}

test("@axe WCAG 2.2 AA scans auth, public and organizer routes", async ({ page, context }) => {
  for (const [path, state] of [["/dashboard", "sign-in"], ["/signup", "signup"], ["/forgot-password", "password-request"], ["/verify-email", "verification-request"], ["/book/strategy-call", "public-booking"]] as const) {
    await page.goto(path); await page.getByRole("heading").first().waitFor(); await scan(page, state);
  }
  await login(page);
  for (const [path, state] of [["/dashboard", "dashboard"], ["/settings", "settings"], ["/integrations", "integrations"], ["/event-types", "event-types"], ["/event-types/new", "event-editor"], ["/availability", "availability"], ["/bookings", "bookings"]] as const) {
    await page.goto(path); await page.getByRole("heading").first().waitFor(); await scan(page, state);
  }
  await assertNoClientSecretState(context, page);
});

test("@axe profile photo upload, reload, removal and fail-closed error", async ({ page, context }) => {
  const profilePng = { name: "synthetic-profile.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYPj/n4GBgYGJAQoAHgQCAf5Z5WQAAAAASUVORK5CYII=", "base64") };
  await login(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Profile photo" })).toBeVisible();

  const existingRemove = page.getByRole("button", { name: "Remove" }).first();
  if (await existingRemove.isVisible().catch(() => false)) { await existingRemove.click(); await expect(page.getByRole("status")).toContainText("Profile photo removed"); }

  const choose = page.getByRole("button", { name: "Choose photo" });
  await choose.focus(); await expect(choose).toBeFocused();
  await page.locator("#profile-photo-upload").evaluate((input) => input.addEventListener("click", () => { input.dataset.keyboardActivated = "true"; }, { once: true }));
  await page.keyboard.press("Enter");
  await expect(page.locator("#profile-photo-upload")).toHaveAttribute("data-keyboard-activated", "true");
  await page.locator("#profile-photo-upload").setInputFiles(profilePng);
  await expect(page.getByRole("status")).toContainText("Profile photo updated");
  await expect(page.locator(".profile-photo .avatar img")).toHaveAttribute("alt", /profile$/);
  await expect(page.locator(".topbar .avatar img")).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain("data:image");

  await page.reload();
  await expect(page.locator(".profile-photo .avatar img")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByRole("status")).toContainText("Profile photo removed");
  await expect(page.locator(".profile-photo .avatar img")).toHaveCount(0);

  await page.locator("#profile-photo-upload").setInputFiles({ name: "not-an-image.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(page.locator(".toast-error")).toContainText("Choose a PNG, JPG, or WebP");

  await page.route("**/api/account/profile-image", async (route) => {
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_PROFILE_IMAGE", message: "The selected image was rejected." } }) });
  }, { times: 1 });
  await page.locator("#profile-photo-upload").setInputFiles(profilePng);
  await expect(page.locator(".toast-error")).toContainText("selected image was rejected");
  await expect(page.locator(".profile-photo .avatar img")).toHaveCount(0);
  await scan(page, "profile-photo-error");
  await assertNoClientSecretState(context, page);
});

test("@axe scans onboarding, authority outcomes, local inbox, confirmation and manage states", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const suffix = `axe-${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-").toLowerCase()}`; const email = `${suffix}@example.com`; const password = process.env.PLAYWRIGHT_ACCOUNT_PASSWORD!;
  await untracedJson("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Accessible Account", email, password, workspaceName: `Accessible ${suffix}`, timeZone: "America/Chicago" }) });
  const verification = await latestAccountToken(email, "EMAIL_VERIFY");
  await page.goto(`/verify-email#token=${encodeURIComponent(verification)}`); await expect(page).toHaveURL(`${baseURL}/verify-email`); await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible(); await scan(page, "verified-outcome");
  await login(page, email, password); await expect(page).toHaveURL(/\/onboarding$/); await scan(page, "onboarding");
  await page.getByRole("button", { name: "Open dashboard" }).click(); await expect(page.getByRole("heading", { name: "Scheduling overview" })).toBeVisible();
  await page.goto("/forgot-password"); await page.getByLabel("Email address").fill(email); await page.getByRole("button", { name: "Request reset instructions" }).click(); await expect(page.getByRole("status")).toContainText("Request accepted"); const reset = await latestAccountToken(email, "PASSWORD_RESET");
  await page.goto(`/reset-password#token=${encodeURIComponent(reset)}`); await expect(page).toHaveURL(`${baseURL}/reset-password`); await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible(); await scan(page, "reset-token-form");

  await context.clearCookies(); await login(page, organizerEmail, organizerPassword);
  const managed = await createManagedBooking(context, `${suffix}-manage`);
  await page.goto(`/book/strategy-call/confirmation?booking=${encodeURIComponent(managed.id)}`); await expect(page.getByRole("heading", { name: /You’re booked/ })).toBeVisible(); await scan(page, "booking-confirmation");
  await page.goto(`/manage/${managed.id}/reschedule?slug=strategy-call`); await expect(page.getByRole("heading", { name: "Choose a new time" })).toBeVisible({ timeout: 60_000 }); await scan(page, "manage-reschedule");
  await page.goto(`/manage/${managed.id}/cancel?slug=strategy-call`); await expect(page.getByRole("heading", { name: /Cancel/ })).toBeVisible(); await scan(page, "manage-cancel");

  await page.goto("/settings"); await page.getByLabel("Invitee email").fill(email); await page.getByLabel("Workspace role").selectOption("MEMBER"); await page.getByRole("button", { name: "Send invitation" }).click();
  const invitation = await latestInvitationToken(email); await context.clearCookies(); await attachSession(context, email, password);
  await page.goto(`/invite/accept#token=${encodeURIComponent(invitation)}`); await expect(page).toHaveURL(`${baseURL}/invite/accept`); await expect(page.getByRole("heading", { name: "You’re in" })).toBeVisible(); await scan(page, "invitation-accepted");

  await context.clearCookies(); await login(page, organizerEmail, organizerPassword); await page.request.post("/api/integrations/email/inbox"); await page.goto("/integrations"); await expect(page.getByRole("heading", { name: "Demo inbox" })).toBeVisible(); await scan(page, "local-inbox");
  await assertNoClientSecretState(context, page);
});

test("@axe keyboard focus, modal trap, Escape return and mobile navigation", async ({ page, context }) => {
  await login(page);
  await page.goto("/dashboard");
  await expect(page.locator(".app-shell")).toBeVisible();
  const skip = page.getByRole("link", { name: "Skip to content" });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  if ((page.viewportSize()?.width ?? 999) < 600) {
    const menu = page.getByRole("button", { name: "Open navigation" });
    await menu.focus(); await page.keyboard.press("Enter");
    const navigation = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole("button", { name: "Close navigation" }).first()).toBeFocused();
    await page.keyboard.press("Escape"); await expect(navigation).toBeHidden(); await expect(menu).toBeFocused();
  }

  const bookingLabel = `keyboard-${test.info().project.name}`;
  await createManagedBooking(context, bookingLabel);
  await page.goto("/bookings");
  const row = page.locator(".booking-table-row").filter({ has: page.getByText(`Invitee ${bookingLabel}`, { exact: true }) });
  await expect(row).toHaveCount(1);
  await row.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Strategy Call/i });
  await expect(dialog).toBeVisible(); await expect(page.getByRole("button", { name: "Close booking details" }).last()).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(row).toBeFocused();
  await assertNoClientSecretState(context, page);
});

test.afterAll(async () => { await db.$disconnect(); });
