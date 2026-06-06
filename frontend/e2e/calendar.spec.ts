import { expect, test, type Page } from "@playwright/test";
import { loginAndOnboard } from "./helpers";

/** Switch view via the app's D/W/M keyboard shortcuts (no dropdown). */
async function switchView(page: Page, key: "d" | "w" | "m") {
  await page.locator("body").press(key);
}

test.describe("Calendar views", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndOnboard(page);
  });

  test("day view renders the time grid and sidebar", async ({ page }) => {
    await expect(page.getByText("Day Load")).toBeVisible();
    await expect(page.getByText("Agenda")).toBeVisible();
    await expect(page.getByText("12 PM")).toBeVisible(); // hour ruler
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  });

  test("week view shows weekday columns", async ({ page }) => {
    await switchView(page, "w");
    await expect(page.getByRole("combobox")).toContainText("week");
    await expect(page.getByText(/Mon\s*\d+/).first()).toBeVisible();
    await expect(page.getByText(/Fri\s*\d+/).first()).toBeVisible();
  });

  test("month view shows the month grid", async ({ page }) => {
    await switchView(page, "m");
    await expect(page.getByRole("combobox")).toContainText("month");
    await expect(page.getByText("Sun", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sat", { exact: true }).first()).toBeVisible();
  });

  test("creating a task schedules it and shows it on the calendar", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByPlaceholder("Do something").fill("E2E Deep Work");
    await page.getByPlaceholder(/comma separated/i).fill("backend, focus");
    await page.getByRole("button", { name: "Save" }).click();

    // Sheet closes on success.
    await expect(page.getByRole("heading", { name: "Create new task" })).toBeHidden();

    // The EDF engine places it on the next work slot; the month grid spans the
    // whole month, so the task is visible there regardless of which day it lands.
    await switchView(page, "m");
    await expect(page.getByText("E2E Deep Work").first()).toBeVisible();
  });
});
