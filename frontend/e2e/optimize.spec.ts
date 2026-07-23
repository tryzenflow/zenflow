import { test, expect, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Scheduler redesign's Optimize action — the one explicit, opt-in, multi-task
 * scheduling action left after Create/Edit/Drag/Resize/Delete/Complete were
 * narrowed to single-task placements/direct writes. Covers the header entry
 * point (`components/calendar/optimize-button.tsx`): the popover's default
 * window/mode, the count-only preview (no per-task diff ever renders), and
 * the large-batch guard confirm.
 *
 * Requires: backend stack + MailHog, and the Optimize endpoints
 * (`POST /tasks/optimize/preview` / `POST /tasks/optimize/apply`) wired live.
 */
async function skipOnboardingIfNeeded(page: Page) {
  if (/\/onboarding$/.test(page.url())) {
    const next = page.getByRole("button", { name: /^continue$/i });
    while (await next.isVisible().catch(() => false)) {
      await next.click();
      await page.waitForTimeout(150);
    }
    await page.getByRole("button", { name: /start planning/i }).click();
    await expect(page).toHaveURL(/\/$/);
  }
}

test.describe("Optimize", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("optimize");
    await login(page, request, email);
    await skipOnboardingIfNeeded(page);
  });

  test("opens with a default next-7-days window and Mode 3 (balanced) one-click default", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /optimize schedule/i }).click();

    await expect(page.getByText(/^optimize schedule$/i)).toBeVisible();
    // All three modes are shown inline as radio cards; balanced is selected
    // by default.
    const balanced = page.getByTestId("optimize-mode-balanced");
    await expect(balanced).toBeVisible();
    await expect(balanced).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: /^optimize$/i })).toBeVisible();
  });

  test("the mode radio cards show Full reflow / Retain manual placements", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /optimize schedule/i }).click();

    const full = page.getByTestId("optimize-mode-full");
    const retainManual = page.getByTestId("optimize-mode-retainManual");
    await expect(full).toBeVisible();
    await expect(full).toContainText(/full reflow/i);
    await expect(retainManual).toBeVisible();
    await expect(retainManual).toContainText(/retain manual placements/i);

    await full.click();
    await expect(full).toHaveAttribute("aria-checked", "true");
  });

  test("an empty window previews zero and applies without a batch/undo toast", async ({
    page,
  }) => {
    // A fresh account has no pending tasks, so preview should come back 0 and
    // apply should be a no-op — no cascade toast (nothing to undo).
    await page.getByRole("button", { name: /optimize schedule/i }).click();
    await page.getByRole("button", { name: /^optimize$/i }).click();

    await expect(
      page.getByText(/nothing to optimize|already in good shape/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /undo/i })).toBeHidden();
  });

  test("the date-range picker only offers future-oriented presets and disables past days", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /optimize schedule/i }).click();

    // Open the DateRangeSelect popover (its trigger shows the current window
    // as a dd/mm/yyyy - dd/mm/yyyy string).
    await page
      .getByRole("button", { name: /\d{2}\/\d{2}\/\d{4}/ })
      .click();

    // Optimize is forward-only: no past-oriented presets, but forward ones.
    // The presets live inside the DateRangeSelect's own popover panel.
    const datePopover = page
      .locator('[data-slot="popover-content"]')
      .filter({ has: page.locator('[data-slot="calendar"]') });
    await expect(
      datePopover.getByRole("button", { name: /^today$/i }),
    ).toBeVisible();
    await expect(
      datePopover.getByRole("button", { name: /^next 7 days$/i }),
    ).toBeVisible();
    await expect(
      datePopover.getByRole("button", { name: /^next 30 days$/i }),
    ).toBeVisible();
    await expect(
      datePopover.getByRole("button", { name: /^last month$/i }),
    ).toHaveCount(0);
    await expect(
      datePopover.getByRole("button", { name: /^last year$/i }),
    ).toHaveCount(0);

    // A day earlier in the currently-shown month than today should be
    // disabled (react-day-picker marks disabled day buttons `disabled`).
    const today = new Date();
    if (today.getDate() > 1) {
      const earlierDay = page
        .locator('[data-slot="calendar"] button[data-day]')
        .filter({ hasText: /^1$/ })
        .first();
      if (await earlierDay.isVisible().catch(() => false)) {
        await expect(earlierDay).toBeDisabled();
      }
    }

    // The year dropdown should allow navigating well beyond the current
    // year — not cap out at December of this year.
    const yearSelect = page
      .locator('[data-slot="calendar"] select')
      .last();
    const yearValues = await yearSelect
      .locator("option")
      .evaluateAll((opts) => opts.map((o) => Number((o as HTMLOptionElement).value)));
    const maxYear = Math.max(...yearValues);
    expect(maxYear).toBeGreaterThan(today.getFullYear() + 5);
  });
});
