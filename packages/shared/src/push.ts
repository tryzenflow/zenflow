/**
 * Native mobile push — device registration + the payload the app receives.
 *
 * A device is identified by a single opaque provider token (an FCM registration
 * token on Android, an APNs device token on iOS). Unlike the Web Push protocol
 * there is no per-endpoint key material to carry — the token is the whole
 * address — so registration is just `{ platform, pushToken }`.
 *
 * As everywhere in this package: "absent" is an explicit value, never an
 * optional property, and everything that crosses the wire is a plain string.
 */


/**
 * Which Zenflow chime a push plays. Chosen server-side from the event so the
 * sound is right even when the app is closed (Android binds sound to the
 * notification channel, iOS to the payload's sound file).
 */
export type PushTone = "default" | "reminder" | "urgent";

/** Event slug → tone: reminders are soft, sync conflicts need action, the rest is the default chime. */
export function pushToneFor(eventName: string): PushTone {
  if (eventName === "reminder.fired") return "reminder";
  if (eventName.startsWith("sync_conflict.")) return "urgent";
  return "default";
}

/**
 * Android channel id per tone. Channel sound is immutable once created, so
 * these are new ids (the legacy `"default"` channel keeps the system sound).
 * `-v2`: the first `zenflow-*` channels were created before the sound files
 * shipped in the native build, so they are stuck on the system sound.
 */
export function pushChannelId(tone: PushTone): string {
  return `zenflow-${tone}-v2`;
}

/** Bundled sound file name (iOS payload `sound`, expo-notifications local `sound`). */
export function pushSoundFile(tone: PushTone): string {
  return `zenflow_${tone}.wav`;
}

/** Which push provider a device token belongs to. Mirrors the Prisma enum. */
export type DevicePlatform = "IOS" | "ANDROID";

/** Request body for `POST /devices` — register (or refresh) one device. */
export interface RegisterDeviceInput {
  platform: DevicePlatform;
  pushToken: string;
}

/** Request body for `DELETE /devices` — unregister one device by its token. */
export interface UnregisterDeviceInput {
  pushToken: string;
}

/** `data` payload for `POST /devices`. */
export interface RegisterDeviceResponse {
  id: string;
}

/**
 * The string map delivered alongside a push, for the app to route on when the
 * notification is tapped. FCM `data` values must be strings; the APNs custom
 * payload mirrors this shape for parity, so every value here is a string —
 * `sessionId` is `""` (not omitted) when the notification has no session.
 */
export interface PushDataPayload {
  notificationId: string;
  /** The notification's `eventName` slug, for the app to classify without a round-trip. */
  eventName: string;
  sessionId: string;
  /** In-app path to open — `"/calendar?session=<id>"` or `"/notifications"`. */
  url: string;
}
