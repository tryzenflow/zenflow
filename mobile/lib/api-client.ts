import { t } from "./i18n";
import axios, { isAxiosError } from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useUserStore } from "@/hooks/use-user-store";
import { clearDaySessionCache } from "@/lib/session-cache";
import { resetTimelineScroll } from "@/lib/timeline-scroll";
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

  const hostUri =
    Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const lanHost = hostUri?.split(":")[0];
  if (!lanHost) return envUrl;

  try {
    const url = new URL(envUrl);
    if (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "10.0.2.2"
    ) {
      url.hostname = lanHost;
      return url.toString();
    }
  } catch {
    // envUrl isn't a valid absolute URL — fall through unchanged.
  }
  return envUrl;
}

export const api = axios.create({
  baseURL: resolveBaseURL(),
  withCredentials: true,
  timeout: 8000,
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

// Manual cookie replay is Android-only. iOS's NSURLSession keeps HttpOnly
// cookies in its own jar and replays them itself (web has the browser jar), so
// a hand-set `Cookie` header there is redundant at best and, when it comes from
// a stale cached value, actively breaks auth.
const MANUAL_COOKIES = Platform.OS === "android";

export async function restoreSessionCookie() {
  if (!MANUAL_COOKIES) return;
  sessionCookie = await readCachedSessionCookie();
}

if (MANUAL_COOKIES) {
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
api.interceptors.response.use(undefined, async (error) => {
  if (
    isAxiosError(error) &&
    error.response?.data &&
    typeof error.response.data === "object"
  ) {
    const body = error.response.data;
    if (typeof body.message === "string") body.message = t(body.message);
    else if (Array.isArray(body.message))
      body.message = body.message.map((message: unknown) =>
        typeof message === "string" ? t(message) : message,
      );
  }
  if (
    isAxiosError(error) &&
    (error.response?.status === 401 || error.response?.status === 403)
  ) {
    // Ignore failures from a request sent with a cookie that has since been
    // replaced (e.g. the startup `/auth/me` carrying a stale cached cookie
    // resolving *after* the user logged in): it says nothing about the new
    // session, and signing out here would wipe it.
    if (MANUAL_COOKIES) {
      const sent = (error.config?.headers?.get?.("Cookie") as string) ?? null;
      if (sent !== sessionCookie) return Promise.reject(error);
    }
    useUserStore.getState().setUser(null);
    // Same per-user cleanup as Settings sign-out.
    clearDaySessionCache();
    resetTimelineScroll();
    await clearCachedSessionUser();
    await clearSession();
  }
  return Promise.reject(error);
});

export async function clearSession() {
  sessionCookie = null;
  if (MANUAL_COOKIES) {
    await clearCachedSessionCookie();
  }
}

export function getSessionCookie(): string | null {
  return sessionCookie;
}

export function getBaseURL(): string | undefined {
  return api.defaults.baseURL || resolveBaseURL();
}
