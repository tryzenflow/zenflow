/** Error code when a DLU login is not the signed-in student's own ID. */
export const STUDENT_ID_MISMATCH = "STUDENT_ID_MISMATCH";

/** Students sign in with `<student id>@dlu.edu.vn` (or a subdomain of it). */
export const STUDENT_EMAIL_DOMAIN = "dlu.edu.vn";

/**
 * The student ID a DLU address belongs to (`2123456@dlu.edu.vn` gives `2123456`),
 * lower-cased; null for any other address. Lookalike domains do not match.
 */
export function studentIdOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  const isDlu =
    domain === STUDENT_EMAIL_DOMAIN ||
    domain.endsWith(`.${STUDENT_EMAIL_DOMAIN}`);
  return isDlu ? email.slice(0, at).trim().toLowerCase() : null;
}

/**
 * Whether a DLU username may be connected to this account. A DLU address only
 * takes its own student ID, so one portal or LMS login cannot feed several
 * Zenflow accounts (emails are unique). Other addresses, which only
 * non-production allow-lists let in, are not checked.
 */
export function usernameMatchesEmail(email: string, username: string): boolean {
  const id = studentIdOf(email);
  return id === null || username.trim().toLowerCase() === id;
}
