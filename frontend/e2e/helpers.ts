import { expect, type Page } from "@playwright/test";

const MAILHOG_API = "http://localhost:8025";

/** A fresh address per test so each run starts from a clean (un-onboarded) user. */
export function uniqueEmail(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${Date.now()}-${rand}@zenflow.test`;
}

/** Poll MailHog for the latest OTP sent to `email` and return the 6-digit code. */
export async function getOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILHOG_API}/api/v2/messages?limit=50`);
    const json = (await res.json()) as {
      items: { Content: { Headers: { To: string[] }; Body: string } }[];
    };
    const msg = json.items.find((m) =>
      (m.Content.Headers.To || []).some((to) => to.includes(email)),
    );
    if (msg) {
      const body = msg.Content.Body.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
      const m = body.match(/>(\d{6})</) || body.match(/\b\d{6}\b/);
      if (m) return m[1] ?? m[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP email arrived for ${email}`);
}

/** Drive the OTP login UI. Leaves the app on whatever route login redirects to. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send OTP" }).click();

  await expect(page.getByText("One-Time Password")).toBeVisible();
  const otp = await getOtp(email);
  // input-otp exposes a single textbox; filling it triggers onComplete → submit.
  await page.getByRole("textbox").fill(otp);
  await expect(page).not.toHaveURL(/\/login/);
}

/** Click through the onboarding wizard to completion (defaults are valid). */
export async function onboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByText("Welcome to Zenflow")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Start planning" }).click();
  await expect(page).toHaveURL("http://localhost:5173/");
}

/** Full path: new user → logged in → onboarded → on the calendar. */
export async function loginAndOnboard(page: Page): Promise<string> {
  const email = uniqueEmail();
  await login(page, email);
  await onboard(page);
  await expect(page.getByText("Day Load")).toBeVisible();
  return email;
}
