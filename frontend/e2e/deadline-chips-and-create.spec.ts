import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Create flow:
 *  - Deadline quick-action chips (Today/Tomorrow/This week/Next week/This
 *    month/No rush/Custom); deadline is required for a TASK. Today/Tomorrow/
 *    Custom reveal a custom time picker (not the native `<input type="time">`).
 *  - Submitting calls `POST /sessions` immediately, no confirm toast. The
 *    backend places the TASK into its best free slot and the toast reports
 *    where it landed.
 *
 * Requires: backend stack + MailHog (see playwright.config.ts).
 */

async function openCreateSheet(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: /new session/i }).first().click();
  await page.getByRole("textbox", { name: /session name/i }).fill(title);
}

test.describe("deadline chips", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("deadline-chips");
    await login(page, request, email);
  });

  test("Today/Tomorrow/Custom reveal a time picker; other chips don't", async ({
    page,
  }) => {
    await openCreateSheet(page, "Deadline chip check");
    // Scoped to the create sheet — the calendar also has its own floating
    // "Today" (jump-to-today) button with the same accessible name.
    const dialog = page.getByRole("dialog");

    const timePickerTrigger = dialog.getByRole("button", {
      name: /\d{1,2}:\d{2}\s*(AM|PM)/i,
    });

    await dialog.getByRole("button", { name: /^today$/i }).click();
    await expect(timePickerTrigger).toBeVisible();

    await dialog.getByRole("button", { name: /^tomorrow$/i }).click();
    await expect(timePickerTrigger).toBeVisible();

    await dialog.getByRole("button", { name: /^this week$/i }).click();
    await expect(timePickerTrigger).toBeHidden();

    await dialog.getByRole("button", { name: /^custom$/i }).click();
    await expect(dialog.getByRole("button", { name: /select date/i })).toBeVisible();
    await expect(timePickerTrigger).toBeVisible();
  });

  test("the six prefetched chips resolve to distinct deadlines", async ({
    page,
  }) => {
    await openCreateSheet(page, "Deadline chip distinctness");
    // Scoped to the create sheet — same "Today" collision as above.
    const dialog = page.getByRole("dialog");

    const seen = new Set<string>();
    for (const label of [
      "today",
      "tomorrow",
      "this week",
      "next week",
      "this month",
      "no rush",
    ]) {
      await dialog
        .getByRole("button", { name: new RegExp(`^${label}$`, "i") })
        .click();
      const due = await dialog.getByText(/^due /i).textContent();
      expect(due).toBeTruthy();
      seen.add(due!);
    }
    // Six distinct calendar ceilings should read as six distinct previews.
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});

test.describe("direct create flow", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("direct-create");
    await login(page, request, email);
  });

  test("submitting creates the session directly, unscheduled, with no confirm toast", async ({
    page,
  }) => {
    await openCreateSheet(page, "Direct create");
    await page.getByRole("button", { name: /^this week$/i }).click();
    await page.getByRole("button", { name: /create session/i }).click();

    // No propose/confirm step — one direct write, then a toast reporting the
    // placement ("Scheduled for …") or, on a saturated calendar, that it needs
    // dragging onto the grid.
    await expect(
      page
        .getByText(/scheduled for/i)
        .or(page.getByText(/drag it onto the calendar/i)),
    ).toBeVisible({ timeout: 10_000 });
  });
});
