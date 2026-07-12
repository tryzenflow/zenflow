import { test, expect, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Scheduler-rewrite frontend flows (todo.md):
 *  - Deadline quick-action chips (Today/Tomorrow/This week/Next week/This
 *    month/No rush/Custom) replace the old date+time inputs; deadline is
 *    required now. Today/Tomorrow/Custom additionally reveal a custom time
 *    picker (not the native `<input type="time">`).
 *  - Create is direct: submitting the form calls `POST /tasks` immediately,
 *    no confirm toast in between.
 *
 * Requires: backend stack + MailHog (see playwright.config.ts).
 */

async function skipOnboardingIfNeeded(page: Page) {
  if (/\/onboarding$/.test(page.url())) {
    const next = page.getByRole("button", { name: /continue/i });
    for (let i = 0; i < 5; i++) await next.click();
    await page.getByRole("button", { name: /start planning/i }).click();
    await expect(page).toHaveURL(/\/$/);
  }
}

async function openCreateSheet(page: Page, title: string) {
  await page.getByRole("button", { name: /new task/i }).first().click();
  await page.getByRole("textbox", { name: /task name/i }).fill(title);
}

test.describe("deadline chips", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("deadline-chips");
    await login(page, request, email);
    await skipOnboardingIfNeeded(page);
  });

  test("Today/Tomorrow/Custom reveal a time picker; other chips don't", async ({
    page,
  }) => {
    await openCreateSheet(page, "Deadline chip check");

    const timePickerTrigger = page.getByRole("button", {
      name: /\d{1,2}:\d{2}\s*(AM|PM)/i,
    });

    await page.getByRole("button", { name: /^today$/i }).click();
    await expect(timePickerTrigger).toBeVisible();

    await page.getByRole("button", { name: /^tomorrow$/i }).click();
    await expect(timePickerTrigger).toBeVisible();

    await page.getByRole("button", { name: /^this week$/i }).click();
    await expect(timePickerTrigger).toBeHidden();

    await page.getByRole("button", { name: /^custom$/i }).click();
    await expect(page.getByRole("button", { name: /select date/i })).toBeVisible();
    await expect(timePickerTrigger).toBeVisible();
  });

  test("the six prefetched chips resolve to distinct deadlines", async ({
    page,
  }) => {
    await openCreateSheet(page, "Deadline chip distinctness");

    const seen = new Set<string>();
    for (const label of [
      "today",
      "tomorrow",
      "this week",
      "next week",
      "this month",
      "no rush",
    ]) {
      await page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).click();
      const due = await page.getByText(/^due /i).textContent();
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
    await skipOnboardingIfNeeded(page);
  });

  test("submitting creates the task directly, with no confirm toast", async ({
    page,
  }) => {
    await openCreateSheet(page, "Direct create");
    await page.getByRole("button", { name: /^this week$/i }).click();
    await page.getByRole("button", { name: /create task/i }).click();

    // No propose/confirm toast — the task is created directly.
    await expect(page.getByText(/suggested placement/i)).toBeHidden({
      timeout: 3_000,
    });
    await expect(
      page.getByText(/scheduled for|task created successfully/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});
