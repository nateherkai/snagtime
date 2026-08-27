import { expect, test } from "@playwright/test";
import { assertNoHorizontalOverflow } from "./helpers";

test("@booking-steps invitee progress validates forward navigation and remains keyboard operable", async ({ page }) => {
  let publicEventRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/public/strategy-call") publicEventRequestCount += 1;
  });
  await page.goto("/book/strategy-call");
  const firstTime = page.locator(".time-grid button").first();
  await expect(firstTime).toBeVisible();
  expect(publicEventRequestCount).toBe(1);

  const timeStep = page.getByRole("button", { name: "Time step" });
  const detailsStep = page.getByRole("button", { name: /Details step/ });
  const reviewStep = page.getByRole("button", { name: /Review step/ });

  for (const [control, label] of [[timeStep, "Time"], [detailsStep, "Details"], [reviewStep, "Review"]] as const) {
    await expect(control).toContainText(label);
    expect(await control.locator("span").evaluate((element) => getComputedStyle(element).fontSize)).not.toBe("0px");
  }
  await expect(timeStep).toHaveAttribute("aria-current", "step");
  await expect(detailsStep).toHaveAttribute("aria-disabled", "true");
  await expect(reviewStep).toHaveAttribute("aria-disabled", "true");

  await reviewStep.focus();
  await reviewStep.press("Enter");
  await expect(page.locator(".form-error")).toContainText("Choose an available time");
  await expect(timeStep).toHaveAttribute("aria-current", "step");

  await firstTime.click();
  await expect(detailsStep).toHaveAttribute("aria-disabled", "false");
  await detailsStep.focus();
  await detailsStep.press("Enter");

  const detailsHeading = page.getByRole("heading", { name: "Tell us about yourself" });
  await expect(detailsHeading).toBeFocused();
  await expect(reviewStep).toHaveAttribute("aria-disabled", "true");

  await reviewStep.focus();
  await reviewStep.press("Enter");
  await expect(page.locator(".form-error")).toContainText("Enter a valid name and email");
  await expect(detailsHeading).toBeVisible();

  await page.getByLabel("Name").fill("Keyboard Invitee");
  await page.getByLabel("Email address").fill("keyboard-invitee@example.com");
  await expect(reviewStep).toHaveAttribute("aria-disabled", "false");
  await reviewStep.focus();
  await reviewStep.press("Enter");

  const reviewHeading = page.getByRole("heading", { name: "Review your booking" });
  await expect(reviewHeading).toBeFocused();
  await expect(reviewStep).toHaveAttribute("aria-current", "step");

  await timeStep.focus();
  await timeStep.press("Enter");
  await expect(page.getByRole("heading", { name: "Choose a duration" })).toBeFocused();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();

  await detailsStep.focus();
  await detailsStep.press("Enter");
  await reviewStep.focus();
  await reviewStep.press("Enter");
  await expect(reviewHeading).toBeFocused();
  await assertNoHorizontalOverflow(page);
});
