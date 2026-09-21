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

/**
 * Connect to the persistent SSE notification stream (`GET /notifications/stream`).
 * Wraps `react-native-sse` and passes the active session cookie on native platforms.
 * Returns an unsubscribe callback `() => void` that closes the connection.
 */
export function subscribeNotificationsStream(
  options: NotificationStreamOptions,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EventSource = require("react-native-sse").default;
  const { getBaseURL, getSessionCookie } = require("@/lib/api-client");
  const { Platform } = require("react-native");

  const baseURL = getBaseURL();
  const url = `${baseURL}/notifications/stream`;
  const cookie = getSessionCookie();

  const headers: Record<string, string> = {};
  if (cookie && Platform.OS !== "web") {
    headers.Cookie = cookie;
  }

  const es = new EventSource(url, {
    headers,
    withCredentials: true,
  });

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

  const onError = (event: unknown) => {
    options.onError?.(event);
  };

  const onOpen = () => {
    options.onOpen?.();
  };

  es.addEventListener("message", onMessage);
  es.addEventListener("error", onError);
  es.addEventListener("open", onOpen);

  return () => {
    try {
      es.removeEventListener("message", onMessage);
      es.removeEventListener("error", onError);
      es.removeEventListener("open", onOpen);
      es.close();
    } catch (err) {
      console.warn("[notifications-sse] Error closing EventSource:", err);
    }
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
