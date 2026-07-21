import axios, { isAxiosError } from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useUserStore } from "@/hooks/use-user-store";
import {
  cacheSessionCookie,
  clearCachedSessionCookie,
  clearCachedSessionUser,
  readCachedSessionCookie,
} from "@/lib/session";

/**
 * `EXPO_PUBLIC_API_URL` is normally `http://localhost:<port>/...` for local
 * dev. That's fine on web (browser loopback), but on a native device/emulator
 * `localhost` resolves to the device itself, not the machine running the API
 * — the cause of "network error" on mobile. Metro already knows the dev
 * machine's LAN address (it's what the device used to load the JS bundle),
 * so swap it in for a loopback host. Leaves an explicit non-loopback override
 * (e.g. a staging URL) untouched, and falls through unchanged for
 * release/EAS builds where there's no Metro dev server to read a host from.
 */
function resolveBaseURL(): string | undefined {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === "web" || !envUrl) return envUrl;

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const lanHost = hostUri?.split(":")[0];
  if (!lanHost) return envUrl;

  try {
    const url = new URL(envUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.hostname = lanHost;
      return url.toString();
    }
  } catch {
    // envUrl isn't a valid absolute URL — fall through unchanged.
  }
  return envUrl;
}

/**
 * Cookie-aware axios instance for the OTP session cookie (CLAUDE.md §7 — no
 * JWT, the backend sets an httpOnly Set-Cookie on `/auth/otp/verify`).
 *
 * - Web (Expo web target): the browser's own cookie jar handles this via
 *   `withCredentials`, same as `frontend/`. Nothing else needed.
 * - Native (iOS/Android): we capture the raw `Set-Cookie` value ourselves and
 *   replay it verbatim as a `Cookie` header on every request — see
 *   `sessionCookie` below for why we don't read it back from a cookie jar.
 */
export const api = axios.create({
  baseURL: resolveBaseURL(),
  withCredentials: true,
});

/**
 * In-memory copy of the raw `name=value` session cookie pair, persisted via
 * `cacheSessionCookie` so it survives app restarts. Restored once at startup
 * by `restoreSessionCookie` (called from the root layout before the first
 * `/auth/me`).
 *
 * We deliberately never try to read this back out of a native cookie jar.
 * `@react-native-cookies/cookies` and React Native's own automatic cookie
 * replay both go through `android.webkit.CookieManager.getCookie()` on
 * Android, which — like `document.cookie` in a browser — never returns
 * `HttpOnly` cookies. Our session cookie is `HttpOnly` (correctly — it's
 * the whole point), so that read always comes back empty on Android, no
 * `Cookie` header ever gets attached, and every guarded endpoint 403s. A
 * `Set-Cookie` *response* header isn't subject to that restriction (it's a
 * normal HTTP header, not a script-facing API), so we capture the value once,
 * here, the moment we see it, and never rely on reading it back.
 */
let sessionCookie: string | null = null;

function cookiePair(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0].trim();
}

export async function restoreSessionCookie() {
  if (Platform.OS === "web") return;
  sessionCookie = await readCachedSessionCookie();
}

if (Platform.OS !== "web") {
  // Capture `Set-Cookie` off every response (set on `/auth/otp/verify`) and
  // persist it so it survives app restarts.
  api.interceptors.response.use(async (response) => {
    const setCookie = response.headers?.["set-cookie"];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      sessionCookie = cookies.map(cookiePair).join("; ");
      await cacheSessionCookie(sessionCookie);
    }
    return response;
  });

  // ...and replay it as a `Cookie` header on every request.
  api.interceptors.request.use((config) => {
    if (sessionCookie) {
      config.headers.set("Cookie", sessionCookie);
    }
    return config;
  });
}

// Global auth-failure handler: a 401/403 from any guarded endpoint means the
// session is actually dead (expired, revoked, or — previously, on Android —
// never successfully attached). Clear it so `AuthGate` (root layout) reacts
// and redirects to login, instead of leaving a stale "logged in" user stuck
// on a screen that will keep 403ing forever.
api.interceptors.response.use(
  undefined,
  async (error) => {
    if (
      isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      useUserStore.getState().setUser(null);
      await clearCachedSessionUser();
      await clearSession();
    }
    return Promise.reject(error);
  },
);

export async function clearSession() {
  sessionCookie = null;
  if (Platform.OS !== "web") {
    await clearCachedSessionCookie();
  }
}
