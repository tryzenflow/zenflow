import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Onboarding now has a "Duration adjustments" step (auto/ask/never) wired into
 * OnboardingInput.durationAdjustmentMode. A brand-new account lands on
 * /onboarding after OTP login; we walk to the new step, pick a mode, finish, and
 * assert it round-trips into Settings → Scheduling.
 *
 * Requires: backend stack + MailHog (see playwright.config.ts).
 */
test("onboarding exposes the duration-adjustment mode step and persists it", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("onboard-mode");
  await login(page, request, email);

  // New account → onboarding wizard.
  await expect(page).toHaveURL(/\/onboarding$/);

  // Step rail should list the new "Adjustments" step.
  await expect(page.getByText("Adjustments")).toBeVisible();

  // Click through Welcome → Work Hours → Work Days → Your Role → Adjustments.
  const next = page.getByRole("button", { name: /continue/i });
  await next.click(); // → Work Hours
  await next.click(); // → Work Days
  await next.click(); // → Your Role
  await next.click(); // → Adjustments

  await expect(
    page.getByRole("heading", { name: /duration adjustments/i }),
  ).toBeVisible();

  // Choose "Ask first".
  await page.getByTestId("duration-mode-ask").click();
  await expect(page.getByTestId("duration-mode-ask")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await next.click(); // → All Set
  await expect(page.getByText("Adjustments")).toBeVisible();
  await page.getByRole("button", { name: /start planning/i }).click();

  // Onboarded → calendar.
  await expect(page).toHaveURL(/\/$/);

  // Re-open settings and confirm the mode persisted on the Scheduling tab.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("zenflow:open-settings")),
  );
  await page.getByRole("tab", { name: /scheduling/i }).click();
  await expect(page.getByTestId("duration-mode-ask")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
