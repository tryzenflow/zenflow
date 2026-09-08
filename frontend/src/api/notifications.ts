import type {
  NotificationDto,
  NotificationsListResponse,
} from "@zenflow/shared";
import { api } from "./base";

/** One page of the ingestion inbox — unread first, then newest first.
 * `unreadCount` counts the whole inbox (it drives the bell badge). */
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

/** Dismiss (hard-delete) one notification. 404 if it is not the caller's. */
export async function dismissNotification(id: string): Promise<{ id: string }> {
  const { data } = await api.delete(`/notifications/${id}`);
  return data.data;
}
