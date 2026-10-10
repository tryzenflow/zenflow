import { t } from "@/lib/i18n";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { getSessionDetails } from "@/api/tasks";
import { useToast } from "@/components/ui/toast";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useUserStore } from "@/hooks/use-user-store";
import { rescheduleWithToast } from "@/lib/reschedule-toast";
import { PUSH_ACTION_RESCHEDULE, pushCategoryFor } from "@zenflow/shared";
import { notificationToastVisual } from "@/lib/notification-visual";
import {
  claimNotification,
  configureForegroundHandler,
  ensureAndroidChannel,
  hrefFromPushData,
  isLocalNotification,
  notificationIdOf,
  pushOwner,
  registerPushCategories,
} from "@/lib/push";
import { markResponseHandled } from "@/lib/push-response";
import type { Href } from "expo-router";

// Set once, before any notification can arrive.
configureForegroundHandler();

/**
 * Registers this device for native push while a user is signed in, and routes
 * a tapped notification to the right screen.
 *
 * Mounted once from the root layout. Logout-time unregistration lives in the
 * Settings sign-out handler (it must run before the session cookie is cleared).
 */
export function usePushRegistration(): void {
  const router = useRouter();
  const { toast } = useToast();
  const userId = useUserStore((s) => s.user?.id ?? null);
  const language = useUserStore((s) => s.user?.lang);
  const onboarded = useUserStore((s) => s.user?.onboardedAt != null);

  useEffect(() => {
    if (!userId) return;
    void ensureAndroidChannel().catch(() => {});
    void registerPushCategories().catch(() => {});
  }, [userId, language]);

  // Apply the push rule (`decidePushAction`) on login / onboarding completion
  // (`onboarded`) and each time the app returns to the foreground (a token can
  // rotate, or permission can change in system settings).
  useEffect(() => {
    if (!userId) return;

    void usePushStatusStore.getState().sync();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void usePushStatusStore.getState().sync();
    });
    return () => sub.remove();
  }, [userId, onboarded]);

  // Deep-link on tap — both the cold-start case (app launched by the tap) and
  // the warm case (already running). De-duped by notification id so the
  // cold-start response isn't re-handled when the warm listener also sees it.
  useEffect(() => {
    const route = async (
      response: Notifications.NotificationResponse | null,
    ) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      // Module-level, so a remount never replays a saved response (and the
      // Reschedule button never fires twice); the OS copy is cleared too.
      if (!markResponseHandled(`${id}:${response.actionIdentifier}`)) return;
      Notifications.clearLastNotificationResponse();
      const data = response.notification.request.content.data as
        | Record<string, string>
        | undefined;
      // iOS "Reschedule" button on a sync-conflict push: act without opening the app.
      if (
        response.actionIdentifier === PUSH_ACTION_RESCHEDULE &&
        data?.notificationId
      ) {
        await rescheduleWithToast(data.notificationId, toast);
        return;
      }
      // A conflict has no session to open: show the inbox row with its button.
      if (data?.eventName && pushCategoryFor(data.eventName)) {
        router.push("/notifications" as Href);
        return;
      }
      const sessionId = data?.sessionId;
      if (sessionId) {
        try {
          const session = await getSessionDetails(sessionId);
          const targetDate = session.scheduledStartTime ?? session.createdAt;
          router.replace({
            pathname: "/",
            params: { date: targetDate, flash: session.id },
          } as Href);
          return;
        } catch {
          toast({
            title: t("Couldn't find that item"),
            description: t("It's no longer on your calendar."),
            variant: "destructive",
            icon: "calendar-x",
          });
          return;
        }
      }
      router.push(hrefFromPushData(data));
    };

    void Notifications.getLastNotificationResponseAsync().then(route);
    const subResponse =
      Notifications.addNotificationResponseReceivedListener(route);

    // Foreground push listener: shows in-app tap-to-act toast with deleted-session guard
    const subForeground = Notifications.addNotificationReceivedListener(
      (notification) => {
        // The SSE handler already toasted what it posted itself, and a push
        // the SSE stream already presented is a duplicate — one toast each.
        if (
          isLocalNotification(notification) ||
          !claimNotification(
            notificationIdOf(notification),
            pushOwner(notification),
          )
        ) {
          return;
        }
        const data = notification.request.content.data as
          | Record<string, string>
          | undefined;
        const sessionId = data?.sessionId;
        const rawTitle =
          notification.request.content.title || t("New notification");
        const title =
          rawTitle.replace(/^\[.*?\]\s*/, "").trim() || t("New notification");
        const body = notification.request.content.body || undefined;

        toast({
          title,
          description: body,
          ...notificationToastVisual(data?.eventName),
          duration: 7000,
          action: sessionId
            ? {
                label: t("View on calendar"),
                onPress: async () => {
                  try {
                    const session = await getSessionDetails(sessionId);
                    const targetDate =
                      session.scheduledStartTime ?? session.createdAt;
                    router.replace({
                      pathname: "/",
                      params: { date: targetDate, flash: session.id },
                    } as Href);
                  } catch {
                    toast({
                      title: t("Couldn't find that item"),
                      description: t("It's no longer on your calendar."),
                      variant: "destructive",
                      icon: "calendar-x",
                    });
                  }
                },
              }
            : undefined,
        });
      },
    );

    return () => {
      subResponse.remove();
      subForeground.remove();
    };
  }, [router, toast]);
}
