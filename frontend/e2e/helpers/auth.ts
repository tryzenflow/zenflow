import { expect, type Page, type APIRequestContext } from "@playwright/test";

const MAILHOG_URL = process.env.MAILHOG_URL ?? "http://localhost:8025";

/**
 * Poll MailHog for the latest OTP email sent to `email` and extract the 6-digit
 * code. Zenflow auth is OTP + Redis sessions (no passwords), so e2e has to read
 * the code the backend just emailed — MailHog catches it in the local stack.
 */
export async function fetchLatestOtp(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await request.get(
      `${MAILHOG_URL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`,
    );
    if (res.ok()) {
      const body = await res.json();
      const items: Array<{ Content?: { Body?: string } }> = body.items ?? [];
      for (const item of items) {
        const text = item.Content?.Body ?? "";
        const match = text.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP email found for ${email} in MailHog`);
}

/** Unique throwaway address so each run starts from a clean (new) account. */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}+${Date.now()}@zenflow.test`;
}

/**
 * Drive the OTP login UI end-to-end: enter the email, request the code, read it
 * from MailHog, and submit. Leaves the page authenticated (on `/` or
 * `/onboarding` depending on whether the account has onboarded).
 */
export async function login(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("button", { name: /continue|send|code|log/i }).click();

  const otp = await fetchLatestOtp(request, email);
  // input-otp renders one field per digit; fill them in order.
  const otpInputs = page.locator('input[inputmode="numeric"], [data-input-otp] input');
  if ((await otpInputs.count()) > 1) {
    const digits = otp.split("");
    for (let i = 0; i < digits.length; i++) {
      await otpInputs.nth(i).fill(digits[i]);
    }
  } else {
    await page.getByRole("textbox").last().fill(otp);
  }

  await expect(page).toHaveURL(/\/(onboarding)?$/, { timeout: 15_000 });
}
