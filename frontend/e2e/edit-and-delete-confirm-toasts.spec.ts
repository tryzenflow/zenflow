import { test, expect, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Confirm-before-reschedule flows (todo.md): editing a task's deadline, and
 * deleting a task, both surface a toast asking whether to cascade-reschedule
 * — this only exercises that the prompts appear and are dismissable; the
 * cascade math itself is covered by the backend's scheduler specs.
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

async function createTask(page: Page, title: string) {
  await page.getByRole("button", { name: /new task/i }).first().click();
  await page.getByRole("textbox", { name: /task name/i }).fill(title);
  await page.getByRole("button", { name: /^this week$/i }).click();
  await page.getByRole("button", { name: /create task/i }).click();

  await expect(
    page.getByText(/scheduled for|task created successfully/i),
  ).toBeVisible({ timeout: 10_000 });

  // The EDF engine may place the task on any day this week (whichever is
  // earliest-feasible) — switch to month view (`M` shortcut) so the sidebar
  // agenda shows it regardless of which day within the current month it
  // landed on.
  await page.keyboard.press("m");
}

test.describe("edit/delete confirm toasts", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("edit-delete-confirm");
    await login(page, request, email);
    await skipOnboardingIfNeeded(page);
  });

  test("changing the deadline prompts a reschedule-cascade confirm toast", async ({
    page,
  }) => {
    const title = "Deadline change confirm";
    await createTask(page, title);

    // Open the task from the sidebar agenda (mirrors clicking a calendar block).
    await page.getByText(title, { exact: true }).first().click();

    await page.getByRole("button", { name: /^next week$/i }).click();
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/task updated/i)).toBeVisible();
    await expect(page.getByText(/deadline changed for/i)).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /not now/i }).click();
  });

  test("deleting a task prompts a gap-fill confirm toast", async ({ page }) => {
    const title = "Delete gap confirm";
    await createTask(page, title);

    await page.getByText(title, { exact: true }).first().click();
    await page.getByRole("button", { name: /delete task/i }).click();

    await expect(page.getByText(/task deleted/i)).toBeVisible();
    await expect(page.getByText(/reschedule the rest of/i)).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /leave it/i }).click();
  });
});
