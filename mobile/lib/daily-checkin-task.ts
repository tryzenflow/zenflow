import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { restoreSessionCookie } from "@/lib/api-client";
import { applyCheckIn } from "@/lib/daily-checkin";
import { checkInActionOf, checkInSessionIds } from "@/lib/daily-push";

/**
 * Background handler for the evening check-in buttons (issue #255).
 *
 * Android only: its notification actions run this task while the app is in
 * the background or killed. iOS action buttons open the app instead, and
 * `hooks/use-push-registration.ts` applies them there.
 *
 * Imported from `index.ts` so the task is defined before the app mounts.
 */
export const DAILY_CHECKIN_TASK = "zenflow-daily-checkin";

if (Platform.OS === "android") {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    DAILY_CHECKIN_TASK,
    async ({ data, error }) => {
      const noData = Notifications.BackgroundNotificationTaskResult.NoData;
      if (error || !data || !("actionIdentifier" in data)) return noData;
      const action = checkInActionOf(data.actionIdentifier);
      const content = data.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const sessionIds = checkInSessionIds(content?.sessionIds);
      if (!action || sessionIds.length === 0) return noData;
      try {
        // A headless run starts without the app's cookie cache; restore it first.
        await restoreSessionCookie();
        await applyCheckIn(action, sessionIds);
        return noData;
      } catch {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
  void Notifications.registerTaskAsync(DAILY_CHECKIN_TASK).catch(() => {});
}
