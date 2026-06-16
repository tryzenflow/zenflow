import { expect, test, type Page } from "@playwright/test";
import { loginAndOnboard } from "./helpers";

/**
 * Calendar keyboard shortcuts.
 *
 * - `d` / `w` / `m` switch view; `ArrowLeft` / `ArrowRight` step the cursor by
 *   the active view's granularity (same logic as the header prev/next buttons).
 * - All shortcuts must no-op while the user is typing in an editable field
 *   (regression: typing a task title was being read as a view command).
 *
 * Prereqs (same as the rest of e2e/): the Docker stack (Postgres + Redis +
 * MailHog) and the backend API on :5000 must be running. The Vite dev server is
 * started by playwright.config.ts.
 */

/**
 * The header period label. Matched by its year suffix so it never collides with
 * the "New Task" heading rendered inside the create sheet.
 */
function periodHeading(page: Page) {
  return page.getByRole("heading", { level: 2, name: /\d{4}$/ });
}

test.describe("Calendar keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOnboard(page);
  });

  test("arrow keys step the period and d/w/m switch view", async ({ page }) => {
    const heading = periodHeading(page);

    // Day view by default → the label is a full "EEE MMMM d, yyyy" date, so a
    // single ArrowRight/Left is directly observable.
    const dayLabel = await heading.textContent();
    await page.keyboard.press("ArrowRight");
    await expect(heading).not.toHaveText(dayLabel ?? "");
    await page.keyboard.press("ArrowLeft");
    await expect(heading).toHaveText(dayLabel ?? "");

    // Month view: the label is "MMMM yyyy", so stepping by a month changes it.
    await page.keyboard.press("m");
    const monthLabel = await heading.textContent();
    await page.keyboard.press("ArrowRight");
    await expect(heading).not.toHaveText(monthLabel ?? "");
    await page.keyboard.press("ArrowLeft");
    await expect(heading).toHaveText(monthLabel ?? "");

    // Week view granularity: stepping enough weeks crosses into the next month,
    // confirming ArrowRight navigates by a week (label is "MMMM yyyy").
    await page.keyboard.press("w");
    const weekLabel = await heading.textContent();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await expect(heading).not.toHaveText(weekLabel ?? "");
  });

  test("shortcuts are ignored while typing in the task title field", async ({
    page,
  }) => {
    const heading = periodHeading(page);
    const labelBefore = await heading.textContent();

    await page.getByRole("button", { name: "New task" }).click();
    const titleInput = page.getByPlaceholder("What needs to get done?");
    await titleInput.click();

    // These characters/keys would otherwise switch view or step the period.
    await titleInput.pressSequentially("dwm meeting");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");

    // The typed text landed in the field…
    await expect(titleInput).toHaveValue("dwm meeting");
    // …and the calendar period label is untouched.
    await expect(heading).toHaveText(labelBefore ?? "");
  });
});
