/**
 * Optional allow-list of email domains for sign-in (`ALLOWED_EMAIL_DOMAINS`,
 * comma separated, e.g. `dlu.edu.vn`). Unset or blank allows every address, so
 * only the environments that set it (production) are restricted.
 */
export const EMAIL_DOMAIN_NOT_ALLOWED = "EMAIL_DOMAIN_NOT_ALLOWED";

export function parseAllowedDomains(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** Read per call: the guard has no DI, and tests/ops can change the env. */
export function allowedEmailDomains(): string[] {
  return parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
}

/**
 * `true` when no list is set, or the address's domain equals an allowed domain
 * or is a subdomain of one (`x@student.dlu.edu.vn` for `dlu.edu.vn`). Lookalikes
 * (`evil-dlu.edu.vn`, `dlu.edu.vn.evil.com`) do not match.
 */
export function isEmailDomainAllowed(
  email: string,
  allowed: string[] = allowedEmailDomains(),
): boolean {
  if (allowed.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return allowed.some((d) => domain === d || domain.endsWith(`.${d}`));
}
