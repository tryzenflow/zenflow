import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Settings is a tabbed dialog: Insights · Account. There is no "Work" tab —
 * `workStart`/`workEnd`/`workDays` were dropped from `User` with no
 * replacement (education-pivot migration; see `@zenflow/shared`'s `user.ts`),
 * and the scheduler no longer constrains placement to a configured working
 * window.
 * - Insights fetches GET /users/me/preference-matrix on open and renders the
 *   7×24 heatmap (or a cold-start empty state for a fresh user).
 * - Account hosts the signed-in identity + Log out.
 *
 * Requires: backend stack + MailHog + the GET /users/me/preference-matrix
 * endpoint.
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
  });

  test("switches across both tabs", async ({ page }) => {
    await openSettings(page);
    for (const name of ["Insights", "Account"]) {
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

  test("account tab shows the signed-in identity and timezone, no editable work-hours fields", async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole("tab", { name: /account/i }).click();
    await expect(page.getByText(/timezone/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /save changes/i }),
    ).toHaveCount(0);
  });
});
