import type session from "express-session";
import type { Store } from "express-session";

export interface SessionConfigParams {
  /** Secret used to sign the session ID cookie. */
  secret: string;
  /** The session store (Redis in production). */
  store: Store;
  /**
   * Absolute lifetime of an inactive session, in milliseconds. Because we run
   * `rolling: true`, this is effectively an idle timeout: every authenticated
   * request resets the cookie expiry and, in turn, the store (Redis) TTL — so
   * an actively-used session keeps getting extended and never expires mid-use.
   *
   * `connect-redis` derives the Redis key TTL from `cookie.maxAge`, so setting
   * `maxAge` here keeps the cookie and the Redis TTL in sync by construction.
   */
  ttlMs: number;
  /**
   * Whether to set the `Secure` cookie flag (cookie only sent over HTTPS).
   *
   * Decoupled from `NODE_ENV` so it can be configured per-environment via
   * `COOKIE_SECURE`. Must be `true` in production behind TLS; with TLS
   * terminated by a proxy (Caddy), Express needs `trust proxy` set so it
   * recognises the connection as secure and actually emits the cookie.
   */
  secure: boolean;
  /**
   * The `SameSite` cookie attribute, configured via `COOKIE_SAMESITE`.
   *
   * Use `"none"` when the frontend and API are on different registrable
   * domains (cross-site), so the browser sends the cookie on cross-site
   * requests. Browsers reject `SameSite=None` unless `Secure` is also set, so
   * this builder throws if `sameSite === "none"` while `secure === false`.
   */
  sameSite: "lax" | "none" | "strict";
}

/**
 * Builds the `express-session` options.
 *
 * Pure: no I/O, no clock, no randomness — it only maps inputs to an options
 * object, which makes the TTL / rolling behavior unit-testable.
 */
export function buildSessionOptions({
  secret,
  store,
  ttlMs,
  secure,
  sameSite,
}: SessionConfigParams): session.SessionOptions & {
  cookie: session.CookieOptions;
} {
  // Browsers silently reject `SameSite=None` cookies that are not also
  // `Secure`, which would break sessions without any obvious error. Fail loudly
  // at startup instead.
  if (sameSite === "none" && !secure) {
    throw new Error(
      'Invalid cookie config: COOKIE_SAMESITE="none" requires COOKIE_SECURE=true ' +
        "(browsers reject SameSite=None cookies without the Secure flag).",
    );
  }

  return {
    secret,
    store,
    // See https://stackoverflow.com/a/40396102/16164473 for resave/saveUninitialized.
    resave: false,
    saveUninitialized: false,
    // Sliding session: reset the cookie (and thus the Redis TTL) on every
    // response so active use never expires the session.
    rolling: true,
    cookie: {
      maxAge: ttlMs,
      httpOnly: true,
      sameSite,
      secure,
    },
  };
}
