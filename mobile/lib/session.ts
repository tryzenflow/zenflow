import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { User } from "@zenflow/shared";

const SESSION_USER_KEY = "zenflow.session.user";
const SESSION_COOKIE_KEY = "zenflow.session.cookie";

/**
 * Cold-resume cache: written after a successful `verifyOtp` so the app can
 * render immediately without waiting on the `/auth/me` round-trip. The
 * cookie session (`lib/api-client.ts`) remains the source of truth — this is
 * only a display cache and is refreshed from `/auth/me` in the background.
 */
export async function cacheSessionUser(user: User) {
  // No-op on web: expo-secure-store has no web implementation. The browser's
  // own cookie jar + `/auth/me` is the source of truth there anyway (same as
  // `frontend/`), so there's nothing to warm a cache for.
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(SESSION_USER_KEY, JSON.stringify(user));
}

export async function readCachedSessionUser(): Promise<User | null> {
  if (Platform.OS === "web") return null;
  const raw = await SecureStore.getItemAsync(SESSION_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export async function clearCachedSessionUser() {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(SESSION_USER_KEY);
}

/**
 * Raw `Cookie` header value (`name=value`) for the httpOnly session cookie,
 * captured off the `Set-Cookie` response header at login (`lib/api-client.ts`).
 *
 * Native (iOS/Android) can't rely on re-reading this back out of a cookie
 * jar: on Android, `@react-native-cookies/cookies` (and React Native's own
 * automatic cookie replay) both read through
 * `android.webkit.CookieManager.getCookie()`, which — same as `document.cookie`
 * in a browser — never returns `HttpOnly` cookies. So instead we remember the
 * value ourselves the one time it's visible (as a plain response header, which
 * `HttpOnly` doesn't hide) and persist it here to survive app restarts.
 */
export async function cacheSessionCookie(cookie: string) {
  await SecureStore.setItemAsync(SESSION_COOKIE_KEY, cookie);
}

export async function readCachedSessionCookie(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_COOKIE_KEY);
}

export async function clearCachedSessionCookie() {
  await SecureStore.deleteItemAsync(SESSION_COOKIE_KEY);
}
