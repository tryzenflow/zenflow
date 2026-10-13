import { DEFAULT_USER_NAME } from "@zenflow/shared";

const MAX_NAME_LENGTH = 60;

/**
 * A display name guessed from the part of an email before the `@`:
 * `an.nguyen+work@x.com` gives `An Nguyen`. Words with digits are dropped, so a
 * student number (`2012345@dlu.edu.vn`) gives nothing and the account keeps
 * {@link DEFAULT_USER_NAME}, which the app treats as "not set yet".
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  const words = local
    .split(/[._-]+/)
    .filter((w) => /^\p{L}+$/u.test(w))
    .map(
      (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase(),
    );
  const name = words.join(" ").slice(0, MAX_NAME_LENGTH).trim();
  return name || DEFAULT_USER_NAME;
}
