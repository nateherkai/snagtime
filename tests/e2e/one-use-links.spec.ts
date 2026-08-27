import { expect, test, type Page, type Request } from "@playwright/test";
import { attachSession, baseURL, db, latestAccountToken, latestBookingRecoveryToken, latestInvitationToken, login, organizerEmail, organizerPassword, untracedJson } from "./helpers";

test.use({ trace: "off" });

function trackNavigationRequests(page: Page) {
  const urls: string[] = [];
  const listener = (request: Request) => { if (request.isNavigationRequest()) urls.push(request.url()); };
  page.on("request", listener);
  return { urls, stop: () => page.off("request", listener) };
}

async function assertAuthorityClean(page: Page, authority: string, navigationUrls: string[]) {
  const state = await page.evaluate((secret) => ({
    url: location.href.includes(secret),
    html: document.documentElement.outerHTML.includes(secret),
    local: JSON.stringify({ ...localStorage }).includes(secret),
    session: JSON.stringify({ ...sessionStorage }).includes(secret),
  }), authority);
  expect(state).toEqual({ url: false, html: false, local: false, session: false });
  expect(navigationUrls.every((url) => !url.includes(authority) && !url.includes("#token=") && !url.includes("#recovery="))).toBe(true);
}

test("one-use email and booking links use fragments, clean before consume, reject replay, and accept legacy query links", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const suffix = `fragment-${testInfo.project.name.replaceAll(/[^a-z0-9]/gi, "-").toLowerCase()}`;
  const email = `${suffix}@example.com`;
  const password = process.env.PLAYWRIGHT_ACCOUNT_PASSWORD!;
  const replacementPassword = process.env.PLAYWRIGHT_REPLACEMENT_PASSWORD!;
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));

  await untracedJson("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Fragment Account", email, password, workspaceName: `Fragment ${suffix}`, timeZone: "America/Chicago" }) });
  const verification = await latestAccountToken(email, "EMAIL_VERIFY");
  const verifyRequests = trackNavigationRequests(page);
  await page.goto(`/verify-email#token=${encodeURIComponent(verification)}`);
  await expect(page).toHaveURL(`${baseURL}/verify-email`);
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
  verifyRequests.stop();
  await assertAuthorityClean(page, verification, verifyRequests.urls);

  await page.goto(`/verify-email#token=${encodeURIComponent(verification)}`);
  await expect(page.getByRole("heading", { name: "This link cannot be used" })).toBeVisible();
  await assertAuthorityClean(page, verification, []);

  const legacyEmail = `legacy-${suffix}@example.com`;
  await untracedJson("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Legacy Account", email: legacyEmail, password, workspaceName: `Legacy ${suffix}`, timeZone: "UTC" }) });
  const legacyVerification = await latestAccountToken(legacyEmail, "EMAIL_VERIFY");
  await page.goto(`/verify-email?token=${encodeURIComponent(legacyVerification)}`);
  await expect(page).toHaveURL(`${baseURL}/verify-email`);
  await expect(page.getByRole("heading", { name: "Your email is verified" })).toBeVisible();
  await assertAuthorityClean(page, legacyVerification, []);

  await untracedJson("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });
  const reset = await latestAccountToken(email, "PASSWORD_RESET");
  const resetRequests = trackNavigationRequests(page);
  await page.goto(`/reset-password#token=${encodeURIComponent(reset)}`);
  await expect(page).toHaveURL(`${baseURL}/reset-password`);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  resetRequests.stop();
  await assertAuthorityClean(page, reset, resetRequests.urls);
  await page.getByLabel("New password").fill(replacementPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
  await page.goto(`/reset-password#token=${encodeURIComponent(reset)}`);
  await page.getByLabel("New password").fill(password);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await assertAuthorityClean(page, reset, []);

  await context.clearCookies();
  await login(page, organizerEmail, organizerPassword);
  await page.goto("/settings");
  await page.getByLabel("Invitee email").fill(email);
  await page.getByLabel("Workspace role").selectOption("MEMBER");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation created");
  const invitation = await latestInvitationToken(email);
  await context.clearCookies();
  await attachSession(context, email, replacementPassword);
  const invitationRequests = trackNavigationRequests(page);
  await page.goto(`/invite/accept#token=${encodeURIComponent(invitation)}`);
  await expect(page).toHaveURL(`${baseURL}/invite/accept`);
  await expect(page.getByRole("heading", { name: "You’re in" })).toBeVisible();
  invitationRequests.stop();
  await assertAuthorityClean(page, invitation, invitationRequests.urls);
  await page.goto(`/invite/accept#token=${encodeURIComponent(invitation)}`);
  await expect(page.getByRole("heading", { name: "This invitation cannot be used" })).toBeVisible();
  await assertAuthorityClean(page, invitation, []);

  await context.clearCookies();
  const event = await db.eventType.findFirstOrThrow({ where: { slug: "strategy-call" }, include: { durations: { where: { isActive: true }, take: 1 } } });
  const duration = event.durations[0]; if (!duration) throw new Error("The seeded event has no active duration.");
  const startAt = new Date(Date.now() + 120 * 86_400_000 + testInfo.workerIndex * 3_600_000);
  const booking = await db.booking.create({ data: { workspaceId: event.workspaceId, eventTypeId: event.id, hostId: event.ownerId, durationId: duration.id, durationMinutes: duration.durationMinutes, inviteeName: "Fragment Invitee", inviteeEmail: email, inviteeTimeZone: "America/Chicago", startAt, endAt: new Date(startAt.getTime() + duration.durationMinutes * 60_000), eventTitleSnapshot: event.name, capabilityVersion: crypto.randomUUID(), manageExpiresAt: new Date(startAt.getTime() + 30 * 86_400_000) } });
  await untracedJson("/api/bookings/manage-link", { method: "POST", body: JSON.stringify({ bookingId: booking.id, email }) });
  const recovery = await latestBookingRecoveryToken(booking.id);
  const recoveryRequests = trackNavigationRequests(page);
  await page.goto(`/manage/${booking.id}/reschedule#recovery=${encodeURIComponent(recovery)}`);
  await expect(page).toHaveURL(`${baseURL}/manage/${booking.id}/reschedule`);
  await expect(page.getByRole("heading", { name: "Choose a new time" })).toBeVisible({ timeout: 60_000 });
  recoveryRequests.stop();
  await assertAuthorityClean(page, recovery, recoveryRequests.urls);
  await context.clearCookies();
  await page.goto(`/manage/${booking.id}/reschedule#recovery=${encodeURIComponent(recovery)}`);
  await expect(page.getByRole("heading", { name: "Booking unavailable" })).toBeVisible();
  await assertAuthorityClean(page, recovery, []);

  expect(consoleMessages.some((message) => [verification, legacyVerification, reset, invitation, recovery].some((authority) => message.includes(authority)))).toBe(false);
});
