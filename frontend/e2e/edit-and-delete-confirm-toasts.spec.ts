import { test, expect, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Reschedule redesign (todo.md): a deadline/tags edit or a delete that would
 * leave a same-day conflict/gap behind is now handled INLINE by the
 * backend's cost-based scheduler — there's no more separate
 * confirm-before-reschedule prompt (the old "wide cascade" fallback and its
 * `POST /tasks/reschedule-cascade` endpoint are gone). This exercises that
 * neither a deadline edit nor a delete surfaces the old blocking prompt. The
 * cost-based placement math itself is covered by the backend's scheduler
 * specs.
 *
 * Requires: backend stack + MailHog (see playwright.config.ts).
 */

async function skipOnboardingIfNeeded(page: Page) {
  if (/\/onboarding$/.test(page.url())) {
    // Click through however many "Continue" steps the wizard has (rather
    // than a hardcoded count) so this doesn't break if a step is added.
    const next = page.getByRole("button", { name: /^continue$/i });
    while (await next.isVisible().catch(() => false)) {
      await next.click();
      await page.waitForTimeout(150);
    }
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

  test("changing the deadline auto-resolves inline, with no confirm prompt", async ({
    page,
  }) => {
    const title = "Deadline change auto-resolve";
    await createTask(page, title);

    // Open the task from the sidebar agenda (mirrors clicking a calendar block).
    await page.getByText(title, { exact: true }).first().click();

    await page.getByRole("button", { name: /^next week$/i }).click();
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/task updated/i)).toBeVisible();
    // The backend already auto-resolved any conflict this left behind
    // inline — the old blocking confirm-before-reschedule prompt no longer
    // fires for the common (non-conflict) case.
    await expect(page.getByText(/deadline changed for/i)).toBeHidden({
      timeout: 3_000,
    });
  });

  test("deleting a task no longer prompts a gap-fill confirm toast", async ({
    page,
  }) => {
    const title = "Delete gap confirm";
    await createTask(page, title);

    await page.getByText(title, { exact: true }).first().click();
    await page.getByRole("button", { name: /delete task/i }).click();

    await expect(page.getByText(/task deleted/i)).toBeVisible();
    await expect(
      page.getByText(/left a gap in your schedule/i),
    ).toBeHidden({ timeout: 3_000 });
  });
});
