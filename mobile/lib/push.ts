import type { DevicePlatform, PushDataPayload } from "@zenflow/shared";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deviceStatus, registerDevice, unregisterDevice } from "@/api/devices";
import { debugLog } from "@/lib/debug-log";
import { decideLaunchSync } from "@/lib/push-sync";

/**
 * Native push plumbing for the direct-FCM/APNs backend (`backend/src/devices/`).
 *
 * We take the **raw** device token (`getDevicePushTokenAsync`), not an Expo
 * push token — the backend talks to FCM / APNs itself and never goes through
 * Expo's push service. That token is what `POST /devices` stores.
 *
 * All of this is a no-op on web (no native push) and on a simulator without a
 * push capability; every entry point fails soft.
 */

export const ANDROID_CHANNEL_ID = "default";

/**
 * `data.source` on the system notification the SSE handler posts itself
 * (`hooks/use-notifications.ts`), so the foreground push listener can tell it
 * from a server push and not toast it a second time.
 */
export const LOCAL_NOTIFICATION_SOURCE = "sse-local";

// One backend notification reaches a foregrounded app twice — over the SSE
// stream and as a native push (`PushService` fans out the same event) — and
// both carry its `notificationId`. Whichever channel arrives first claims the
// id and is the only one presented; the other is swallowed.
const claimedBy = new Map<string, string>();
const CLAIM_CAP = 200;

/**
 * `true` if `owner` may present notification `id`: nobody claimed it yet, or
 * `owner` already did (the push handler and the push listener both see the
 * same push, so each passes the push's own request identifier as `owner`).
 */
export function claimNotification(
  id: string | undefined | null,
  owner: string,
): boolean {
  if (!id) return true;
  const current = claimedBy.get(id);
  if (current !== undefined) return current === owner;
  claimedBy.set(id, owner);
  if (claimedBy.size > CLAIM_CAP) {
    claimedBy.delete(claimedBy.keys().next().value as string);
  }
  return true;
}

/** Owner key for a native notification (its OS request identifier). */
export function pushOwner(n: Notifications.Notification): string {
  return `push:${n.request.identifier}`;
}

function notificationData(
  n: Notifications.Notification,
): Record<string, unknown> | undefined {
  return n.request.content.data as Record<string, unknown> | undefined;
}

/** The SSE handler's own system notification (never toasted again). */
export function isLocalNotification(n: Notifications.Notification): boolean {
  return notificationData(n)?.source === LOCAL_NOTIFICATION_SOURCE;
}

/** Backend `notificationId` a push/local notification carries, if any. */
export function notificationIdOf(
  n: Notifications.Notification,
): string | undefined {
  const id = notificationData(n)?.notificationId;
  return typeof id === "string" && id ? id : undefined;
}

/** How a foreground push is presented while the app is open. */
export function configureForegroundHandler(): void {
  // No native push on web (see file header) — `expo-notifications` has no
  // web shim for this call, and it runs at module scope (before any
  // Platform-gated effect), so an unguarded call here throws on import and
  // breaks the whole root layout's module evaluation on web.
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A server push the SSE stream already presented (toast + its own
      // system notification) stays silent.
      const duplicate =
        !isLocalNotification(n) &&
        !claimNotification(notificationIdOf(n), pushOwner(n));
      return {
        // `shouldShowAlert` is deprecated in favor of the banner/list split
        // below (iOS 14+ distinguishes a foreground banner from the
        // notification-list entry) -- kept too since it's still read on
        // older platforms/typings that predate the split.
        shouldShowAlert: !duplicate,
        shouldShowBanner: !duplicate,
        shouldShowList: !duplicate,
        shouldPlaySound: !duplicate,
        shouldSetBadge: !duplicate,
      };
    },
  });
}

/** Android 8+ needs an explicit channel or notifications are dropped silently. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "General",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#f97316",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export interface NativePushToken {
  platform: DevicePlatform;
  token: string;
}

/**
 * Ask for permission (if not already decided) and return the raw FCM/APNs
 * token, or `null` when push isn't available or was denied. Safe to call on
 * every launch — the OS prompt only shows the first time.
 */
export async function getNativePushToken(): Promise<NativePushToken | null> {
  if (Platform.OS === "web") return null;
  // The iOS Simulator can't obtain an APNs token; an Android emulator with
  // Play Services can get an FCM token, so only hard-block the former.
  if (Platform.OS === "ios" && !Device.isDevice) {
    debugLog("push", "skipped: iOS simulator has no APNs");
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") {
    debugLog("push", `permission not granted (${status})`);
    return null;
  }

  await ensureAndroidChannel();

  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const platform: DevicePlatform =
      devicePushToken.type === "ios" ? "IOS" : "ANDROID";
    return { platform, token: String(devicePushToken.data) };
  } catch (err) {
    // Missing google-services.json / APNs entitlement, no network, etc.
    debugLog("push", `getDevicePushTokenAsync failed: ${String(err)}`);
    return null;
  }
}

/**
 * Where a tapped notification should land. The backend's `PushDataPayload.url`
 * is web-shaped (`/calendar?session=…`), so route off `sessionId` instead and
 * reuse the same target the in-app inbox row uses.
 */
export function hrefFromPushData(
  data: Partial<PushDataPayload> | undefined,
): Href {
  const sessionId = data?.sessionId;
  if (sessionId) {
    return `/task/${encodeURIComponent(sessionId)}/edit` as Href;
  }
  return "/notifications" as Href;
}

/** Last token this install registered; non-preference marker (see push-sync). */
const REGISTERED_TOKEN_KEY = "push.registeredToken";

async function readMarker(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(REGISTERED_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeMarker(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(REGISTERED_TOKEN_KEY, token);
    else await AsyncStorage.removeItem(REGISTERED_TOKEN_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Current OS permission and, if granted, this device's token. Never prompts.
 */
export async function readPushState(): Promise<{
  permissionGranted: boolean;
  token: string | null;
}> {
  if (Platform.OS === "web") return { permissionGranted: false, token: null };
  try {
    const granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) return { permissionGranted: false, token: null };
    if (Platform.OS === "ios" && !Device.isDevice) {
      return { permissionGranted: true, token: null };
    }
    const t = await Notifications.getDevicePushTokenAsync();
    return { permissionGranted: true, token: String(t.data) };
  } catch {
    return { permissionGranted: false, token: null };
  }
}

/** Is `token` registered to the signed-in user? `null` if the call failed. */
export async function fetchRegistered(token: string): Promise<boolean | null> {
  try {
    return (await deviceStatus(token)).registered;
  } catch {
    return null;
  }
}

/**
 * EXPLICIT enable (toggle / onboarding): ask for permission if needed and
 * register this device. Returns the registered token, or `null`.
 */
export async function enablePushRegistration(): Promise<string | null> {
  const t = await getNativePushToken();
  if (!t) return null;
  try {
    await registerDevice(t.platform, t.token);
    await writeMarker(t.token);
    debugLog("push", `registered ${t.platform} token …${t.token.slice(-6)}`);
    return t.token;
  } catch (err) {
    debugLog("push", `register failed: ${String(err)}`);
    return null;
  }
}

/**
 * Launch / foreground / login sync. Never prompts and never newly opts a
 * device in; it only keeps an existing registration alive across token
 * rotation (rule in `decideLaunchSync`). Call from login and foreground resume.
 */
export async function syncPushRegistration(): Promise<void> {
  const { permissionGranted, token } = await readPushState();
  if (!permissionGranted || !token) return;
  const registered = await fetchRegistered(token);
  if (registered === null) return; // offline: decide next time
  const markerToken = await readMarker();
  const action = decideLaunchSync({
    permissionGranted,
    token,
    registered,
    markerToken,
  });
  if (action === "mark") {
    await writeMarker(token);
  } else if (action === "rotate") {
    try {
      await registerDevice(
        Platform.OS === "ios" ? "IOS" : "ANDROID",
        token,
      );
      await writeMarker(token);
      if (markerToken) await unregisterDevice(markerToken).catch(() => {});
      debugLog("push", "token rotated; re-registered");
    } catch (err) {
      debugLog("push", `rotate failed: ${String(err)}`);
    }
  }
}

/**
 * Unregister this device (turning notifications off, or logout before the
 * session cookie is cleared). Best-effort — never blocks sign-out. Clears the
 * rotation marker so an opt-out is not mistaken for a rotated token.
 */
export async function dropPushRegistration(): Promise<void> {
  if (Platform.OS === "web") return;
  await writeMarker(null);
  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    await unregisterDevice(String(devicePushToken.data));
    debugLog("push", "unregistered this device");
  } catch (err) {
    debugLog("push", `unregister skipped: ${String(err)}`);
  }
}
