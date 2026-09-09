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

import type { NotificationKind, NotificationTopic } from "./notification";

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
  topic: NotificationTopic;
  kind: NotificationKind;
  sessionId: string;
  /** In-app path to open — `"/calendar?session=<id>"` or `"/notifications"`. */
  url: string;
}
