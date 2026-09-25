import type {
  NotificationDto,
  NotificationsListResponse,
  RescheduleConflictsResponse,
} from "@zenflow/shared";
import { notifySessionsMutated } from "@/lib/session-cache";
import { api } from "./base";

/**
 * One page of the ingestion inbox — unread first, then newest first.
 * `unreadCount` counts the whole inbox (it drives the bell badge).
 */
export async function listNotifications(
  params: { limit?: number; offset?: number } = {},
): Promise<NotificationsListResponse> {
  const { data } = await api.get("/notifications", { params });
  return data.data;
}

/** Stamp `readAt`. Idempotent; keeps the first instant. */
export async function markNotificationRead(
  id: string,
): Promise<NotificationDto> {
  const { data } = await api.patch(`/notifications/${id}/read`);
  return data.data;
}

/** Stamp `actionTakenAt` — acting on a notification is not the same as seeing it. */
export async function markNotificationActionTaken(
  id: string,
): Promise<NotificationDto> {
  const { data } = await api.patch(`/notifications/${id}/action-taken`);
  return data.data;
}

/** Dismiss (hard-delete) one notification — the swipe-to-dismiss action. */
export async function dismissNotification(id: string): Promise<{ id: string }> {
  const { data } = await api.delete(`/notifications/${id}`);
  return data.data;
}

export interface NotificationStreamOptions {
  onNotification: (notification: NotificationDto) => void;
  onError?: (error: unknown) => void;
  onOpen?: () => void;
}

/** First retry delay after the stream drops; doubles up to the cap. */
const STREAM_RETRY_MIN_MS = 2_000;
const STREAM_RETRY_MAX_MS = 30_000;

/**
 * Connect to the persistent SSE notification stream (`GET /notifications/stream`).
 * Wraps `react-native-sse` and passes the active session cookie on native platforms.
 * Returns an unsubscribe callback `() => void` that closes the connection.
 *
 * Reconnects with exponential backoff (`react-native-sse` never retries after
 * a transport error). Each attempt re-reads the cookie; `onOpen` fires on every
 * (re)connect so the caller can catch up.
 */
export function subscribeNotificationsStream(
  options: NotificationStreamOptions,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EventSource = require("react-native-sse").default;
  const { getBaseURL, getSessionCookie } = require("@/lib/api-client");
  const { Platform } = require("react-native");

  // biome-ignore lint/suspicious/noExplicitAny: react-native-sse ships no types
  let es: any = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = STREAM_RETRY_MIN_MS;
  let stopped = false;

  const onMessage = (event: { data?: string | null }) => {
    try {
      if (!event.data) return;
      const data =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data && typeof data === "object" && "id" in data) {
        options.onNotification(data as NotificationDto);
      }
    } catch (err) {
      console.warn("[notifications-sse] Failed to parse message:", err);
    }
  };

  const teardown = () => {
    if (!es) return;
    try {
      es.removeAllEventListeners();
      es.close();
    } catch (err) {
      console.warn("[notifications-sse] Error closing EventSource:", err);
    }
    es = null;
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, STREAM_RETRY_MAX_MS);
  };

  function connect() {
    if (stopped) return;
    teardown();

    const headers: Record<string, string> = {};
    const cookie = getSessionCookie();
    if (cookie && Platform.OS !== "web") {
      headers.Cookie = cookie;
    }

    es = new EventSource(`${getBaseURL()}/notifications/stream`, {
      headers,
      withCredentials: true,
    });

    es.addEventListener("open", () => {
      retryDelay = STREAM_RETRY_MIN_MS;
      options.onOpen?.();
    });
    es.addEventListener("message", onMessage);
    // Close (also cancels the library's own re-poll) and retry with backoff.
    es.addEventListener("error", (event: unknown) => {
      options.onError?.(event);
      teardown();
      scheduleReconnect();
    });
  }

  connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    teardown();
  };
}

/** Re-place every session listed in a conflict notification's `conflictSessionIds`. */
export async function rescheduleConflicts(
  id: string,
): Promise<RescheduleConflictsResponse> {
  const { data } = await api.post(`/notifications/${id}/reschedule-conflicts`);
  notifySessionsMutated();
  return data.data;
}
