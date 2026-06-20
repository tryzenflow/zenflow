import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Zenflow frontend e2e suite.
 *
 * These specs drive the real UI against a running stack: the Vite dev server
 * (started below via `webServer`) talking to the backend API, which in turn
 * needs Postgres/Redis/MailHog up (see backend/README.md — the local Docker
 * stack). Logins read the OTP out of MailHog (`e2e/helpers/auth.ts`).
 *
 * Run:  pnpm --filter frontend test:e2e
 * Env:  VITE_API_URL (API base), MAILHOG_URL (default http://localhost:8025).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    testIdAttribute: "data-testid",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: process.env.E2E_BASE_URL ?? "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
