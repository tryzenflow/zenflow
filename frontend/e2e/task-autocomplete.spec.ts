import { expect, test, type Page } from "@playwright/test";
import { loginAndOnboard } from "./helpers";

/**
 * Title-autocomplete in the create-task form.
 *
 * Flow under test: create a "source" task, then start a second create and type
 * a prefix of the source title → the suggestion dropdown appears → selecting it
 * populates the rest of the form (duration, tags, scheduling type, deadline).
 *
 * Prereqs (same as the rest of e2e/): the Docker stack (Postgres + Redis +
 * MailHog) and the backend API on :5000 must be running. The Vite dev server is
 * started by playwright.config.ts.
 */

const SOURCE_TITLE = "Quarterly planning review";

/** Open the create sheet, fill the create-only fields, and submit. */
async function createSourceTask(page: Page) {
  await page.getByRole("button", { name: "New task" }).click();

  await page
    .getByPlaceholder("What needs to get done?")
    .fill(SOURCE_TITLE);

  // Duration preset → 2h (120m), so we can assert it carried over on select.
  await page.getByRole("button", { name: "2h", exact: true }).click();

  // Add a tag via the tag combobox (type + create on save).
  await page.getByRole("button", { name: /Add tag/ }).click();
  await page.getByPlaceholder("Search or create…").fill("strategy");
  await page.getByRole("option", { name: /Create "strategy"/ }).click();

  await page.getByRole("button", { name: "Create Task" }).click();
  await expect(page.getByText(/Task created successfully/)).toBeVisible();
}

test.describe("Task title autocomplete", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOnboard(page);
  });

  test("typing a title surfaces existing-task suggestions and selecting one populates the form", async ({
    page,
  }) => {
    await createSourceTask(page);

    // Start a fresh create and type a prefix of the source title.
    await page.getByRole("button", { name: "New task" }).click();
    const titleInput = page.getByPlaceholder("What needs to get done?");
    await titleInput.fill("Quarterly");

    // Debounced fetch (~250ms) → dropdown lists the source task.
    const suggestion = page.getByRole("option", { name: new RegExp(SOURCE_TITLE) });
    await expect(suggestion).toBeVisible();
    // The muted hint line carries duration + tag + scheduling info.
    await expect(suggestion).toContainText("2h");
    await expect(suggestion).toContainText("#strategy");

    await suggestion.click();

    // Title is now the full source title (the typed text was replaced).
    await expect(titleInput).toHaveValue(SOURCE_TITLE);

    // Duration preset reflects the source task's 2h.
    await expect(page.getByRole("button", { name: "2h", exact: true })).toHaveClass(
      /text-primary/,
    );

    // The strategy tag chip is populated.
    await expect(page.getByText("#strategy")).toBeVisible();
  });

  test("a brand-new title that matches nothing stays submittable", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "New task" }).click();
    const titleInput = page.getByPlaceholder("What needs to get done?");

    const unique = `Totally novel task ${Date.now()}`;
    await titleInput.fill(unique);

    // Typed text is the field value regardless of (zero) suggestions.
    await expect(titleInput).toHaveValue(unique);

    await page.getByRole("button", { name: "Create Task" }).click();
    await expect(page.getByText(/Task created successfully/)).toBeVisible();
  });
});
