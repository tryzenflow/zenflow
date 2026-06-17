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
  /** Whether we're running in production (enables the `secure` cookie flag). */
  isProduction: boolean;
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
  isProduction,
}: SessionConfigParams): session.SessionOptions & {
  cookie: session.CookieOptions;
} {
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
      sameSite: "lax",
      secure: isProduction,
    },
  };
}
