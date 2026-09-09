import type { PushDataPayload } from "@zenflow/shared";

/**
 * A platform-agnostic push, ready for a sender to translate into an FCM
 * message or an APNs notification.
 */
export interface PushMessage {
  title: string;
  body: string;
  data: PushDataPayload;
}

/** What a sender hands back so {@link PushService} can log + prune. */
export interface SendResult {
  /** How many of the given tokens the provider accepted. */
  sent: number;
  /**
   * Tokens the provider rejected as permanently dead (unregistered / gone) —
   * safe to delete. Transient failures are logged by the sender and omitted.
   */
  invalidTokens: string[];
}

/** {@link PushDataPayload} flattened to the string map FCM / APNs require. */
export function toStringMap(data: PushDataPayload): Record<string, string> {
  return {
    notificationId: data.notificationId,
    topic: data.topic,
    kind: data.kind,
    sessionId: data.sessionId,
    url: data.url,
  };
}
