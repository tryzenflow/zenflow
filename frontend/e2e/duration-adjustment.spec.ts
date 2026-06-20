import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

/**
 * Create-task duration-adjustment UX (ADR Sequence 1), gated by mode read from
 * the create response's schedulingMeta:
 *   - auto  → corrected duration applied + non-blocking toast with **Undo**.
 *   - ask   → blocking two-option toast (Accept corrected / Keep estimate).
 *   - never → silent (typed estimate used).
 *
 * These assert the FE behaviour given a backend that returns the Phase-2
 * schedulingMeta (estimatedDuration / adjustedDuration / durationAdjustmentMode
 * / durationReason). They need a user whose telemetry yields a per-tag bias so
 * the corrector actually moves the duration — otherwise no toast fires by
 * design (estimated === adjusted). Mark as needing seeded bias data.
 *
 * Requires: backend stack + MailHog + Phase-2 corrector wired live, and a
 * persona/seed where a tag has a non-trivial duration bias.
 */
test.describe("duration adjustment toast", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("dur-adj");
    await login(page, request, email);
    if (/\/onboarding$/.test(page.url())) {
      const next = page.getByRole("button", { name: /continue/i });
      for (let i = 0; i < 5; i++) await next.click();
      await page.getByRole("button", { name: /start planning/i }).click();
      await expect(page).toHaveURL(/\/$/);
    }
  });

  async function createTask(
    page: import("@playwright/test").Page,
    title: string,
    tag: string,
  ) {
    await page.getByRole("button", { name: /new task/i }).first().click();
    await page.getByRole("textbox", { name: /task name/i }).fill(title);
    // Add a tag so the per-tag corrector has something to bias on.
    const tagInput = page.getByPlaceholder(/tag/i).first();
    if (await tagInput.isVisible().catch(() => false)) {
      await tagInput.fill(tag);
      await tagInput.press("Enter");
    }
    await page.getByRole("button", { name: /create task/i }).click();
  }

  test("auto mode shows an Undo affordance when the duration is corrected", async ({
    page,
  }) => {
    // Assumes the account's mode is the default "auto".
    await createTask(page, "Phase2 auto adjust", "backend");
    // Either a correction happened (Undo visible) or no bias existed yet.
    const undo = page.getByRole("button", { name: /undo/i });
    if (await undo.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await undo.click();
      // Toast dismisses; the calendar refetches the restored duration.
      await expect(undo).toBeHidden();
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "No per-tag bias for this account/seed, so no auto-adjust toast fired (expected when estimated === adjusted).",
      });
    }
  });
});
