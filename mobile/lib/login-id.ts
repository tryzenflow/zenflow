/** Students sign in with their ID; the address is `<id>@dlu.edu.vn`. */
export const STUDENT_EMAIL_DOMAIN = "dlu.edu.vn";

export type LoginMode = "id" | "email";

const STUDENT_EMAIL = new RegExp(
  `^\\s*(\\d+)@${STUDENT_EMAIL_DOMAIN.replace(/\./g, "\\.")}\\s*$`,
  "i",
);

/**
 * Normalises a change to the login field. In ID mode an `@` or a letter
 * (typed, pasted or autofilled) switches to the full email field, except a
 * student address, which collapses back to its ID.
 */
export function parseLoginInput(
  text: string,
  mode: LoginMode,
): { mode: LoginMode; value: string } {
  if (mode === "email") return { mode, value: text };
  const student = STUDENT_EMAIL.exec(text);
  if (student) return { mode: "id", value: student[1] };
  if (/[^\d\s]/.test(text)) return { mode: "email", value: text.trim() };
  return { mode: "id", value: text.replace(/\D/g, "") };
}

/** Field value after the user flips modes: only a student address carries over. */
export function switchLoginMode(value: string, to: LoginMode): string {
  return to === "id" ? (STUDENT_EMAIL.exec(value)?.[1] ?? "") : "";
}

export function studentEmail(id: string): string {
  return `${id}@${STUDENT_EMAIL_DOMAIN}`;
}

/** The address sent to `requestOtp`. */
export function loginEmail(value: string, mode: LoginMode): string {
  return mode === "id" ? studentEmail(value.trim()) : value.trim();
}

/**
 * Pulls a 6-digit code out of typed, pasted or autofilled text. A standalone
 * 6-digit run wins (so "Code 123456, valid 10 minutes" yields 123456);
 * otherwise the digits are kept in order.
 */
export function extractOtp(text: string, length = 6): string {
  const run = text.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`));
  if (run && text.replace(/\D/g, "").length > length) return run[0];
  return text.replace(/\D/g, "").slice(0, length);
}
