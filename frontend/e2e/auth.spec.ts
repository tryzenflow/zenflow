import { expect, test } from "@playwright/test";
import { login, onboard, uniqueEmail } from "./helpers";

test.describe("Authentication & onboarding", () => {
  test("unauthenticated visit redirects to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Login to Zenflow" })).toBeVisible();
  });

  test("OTP login sends a new user to onboarding", async ({ page }) => {
    const email = uniqueEmail();
    await login(page, email);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText("Welcome to Zenflow")).toBeVisible();
  });

  test("completing onboarding lands on the calendar", async ({ page }) => {
    const email = uniqueEmail();
    await login(page, email);
    await onboard(page);
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByText("Day Load")).toBeVisible();
    await expect(page.getByRole("button", { name: "New task" })).toBeVisible();
  });

  test("an onboarded user goes straight to the calendar on next login", async ({
    page,
    context,
  }) => {
    const email = uniqueEmail();
    await login(page, email);
    await onboard(page);
    // Drop the session cookie and log in again.
    await context.clearCookies();
    await login(page, email);
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByText("Day Load")).toBeVisible();
  });
});
