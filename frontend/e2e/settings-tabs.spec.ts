import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Settings is now a tabbed dialog: Work · Insights · Account.
 * - Insights fetches GET /users/me/preference-matrix on open and renders the
 *   7×96 heatmap (or a cold-start empty state for a fresh user).
 * - Account hosts Log out.
 *
 * Requires: backend stack + MailHog + the GET /users/me/preference-matrix
 * endpoint (backend-engineer).
 */
async function openSettings(page: import("@playwright/test").Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("zenflow:open-settings")),
  );
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("tabbed settings", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("settings");
    await login(page, request, email);
    // Skip onboarding fast if a fresh account landed there.
    if (/\/onboarding$/.test(page.url())) {
      const next = page.getByRole("button", { name: /continue/i });
      for (let i = 0; i < 5; i++) await next.click();
      await page.getByRole("button", { name: /start planning/i }).click();
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("switches across all three tabs", async ({ page }) => {
    await openSettings(page);
    for (const name of ["Work", "Insights", "Account"]) {
      await page.getByRole("tab", { name: new RegExp(name, "i") }).click();
      await expect(
        page.getByRole("tab", { name: new RegExp(name, "i") }),
      ).toHaveAttribute("data-state", "active");
    }
  });

  test("insights tab renders the preference map (heatmap or cold-start)", async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole("tab", { name: /insights/i }).click();
    // Either the learned-empty state or the rendered grid legend is present.
    await expect(
      page
        .getByText(/no preferences learned yet/i)
        .or(page.getByText(/prefer/i)),
    ).toBeVisible({ timeout: 10_000 });
  });
});
