const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Canonical form of an email for rate-limit keying only (never for login or
 * OTP delivery): trimmed, lower-cased, `+tag` stripped from the local part,
 * and for Gmail (`gmail.com` / `googlemail.com`) dots dropped and the domain
 * unified, so aliases of one inbox share a bucket.
 */
export function normalizeEmailForRateLimit(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}
