import { test, expect, type Page } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

const API_URL = process.env.VITE_API_URL ?? "http://localhost:5000/api/v1";

async function createSession(page: Page, title: string): Promise<string> {
  await page
    .getByRole("button", { name: /new task/i })
    .first()
    .click();
  await page.getByRole("textbox", { name: /session name/i }).fill(title);
  await page.getByRole("button", { name: /^this week$/i }).click();
  await page.getByRole("button", { name: /create session/i }).click();

  await expect(
    page.getByText(/session created — drag it onto the calendar/i),
  ).toBeVisible({ timeout: 10_000 });

  const res = await page
    .context()
    .request.get(`${API_URL}/sessions/suggestions`, {
      params: { q: title, limit: 1 },
    });
  const body = await res.json();
  const id: string = body.data.suggestions[0].id;

  // Schedule it directly (bypassing drag) so it renders as a clickable block.
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  await page.context().request.patch(`${API_URL}/sessions/${id}`, {
    data: { scheduledStartTime: now.toISOString() },
  });
  await page.reload();

  return id;
}

test.describe("edit/delete confirm toasts", () => {
  test.beforeEach(async ({ page, request }) => {
    const email = uniqueEmail("edit-delete-confirm");
    await login(page, request, email);
  });

  test("changing the deadline is a plain write, with no confirm prompt", async ({
    page,
  }) => {
    const title = "Deadline change auto-resolve";
    await createSession(page, title);

    // Open the session from the calendar block.
    await page.getByText(title, { exact: true }).first().click();

    await page.getByRole("button", { name: /^next week$/i }).click();
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/session updated/i)).toBeVisible();
    // No blocking confirm-before-reschedule prompt fires — that flow (notes.md
    // trigger 2) is explicitly deferred, not built.
    await expect(page.getByText(/deadline changed for/i)).toBeHidden({
      timeout: 3_000,
    });
  });

  test("deleting a session doesn't prompt a gap-fill confirm toast", async ({
    page,
  }) => {
    const title = "Delete gap confirm";
    await createSession(page, title);

    await page.getByText(title, { exact: true }).first().click();
    await page.getByRole("button", { name: /delete session/i }).click();

    await expect(page.getByText(/session deleted/i)).toBeVisible();
    // No blocking confirm-before-reschedule prompt fires — that flow (notes.md
    // trigger 3) is explicitly deferred, not built.
    await expect(page.getByText(/left a gap in your schedule/i)).toBeHidden({
      timeout: 3_000,
    });
  });
});
