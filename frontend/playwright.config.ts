import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Prerequisites (run separately):
 *   - Postgres + Redis + MailHog (docker)
 *   - Backend API on :5000  (cd backend && node dist/main.js)
 * The Vite dev server is started automatically below.
 *
 * OTP codes are read from MailHog's HTTP API (see e2e/helpers.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
