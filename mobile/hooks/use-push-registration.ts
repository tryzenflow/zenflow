import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { getSessionDetails } from "@/api/tasks";
import { useToast } from "@/components/ui/toast";
import { useUserStore } from "@/hooks/use-user-store";
import {
  configureForegroundHandler,
  hrefFromPushData,
  syncPushRegistration,
} from "@/lib/push";
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
  const lastHandledResponseId = useRef<string | null>(null);

  // Register on login, and re-sync each time the app returns to the foreground
  // (a token can rotate, or permission can be granted from Settings.app).
  useEffect(() => {
    if (!userId) return;

    void syncPushRegistration();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncPushRegistration();
    });
    return () => sub.remove();
  }, [userId]);

  // Deep-link on tap — both the cold-start case (app launched by the tap) and
  // the warm case (already running). De-duped by notification id so the
  // cold-start response isn't re-handled when the warm listener also sees it.
  useEffect(() => {
    const route = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id === lastHandledResponseId.current) return;
      lastHandledResponseId.current = id;
      const data = response.notification.request.content.data as
        | Record<string, string>
        | undefined;
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
          toast("That item isn't on your calendar anymore.", "destructive");
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
        const data = notification.request.content.data as
          | Record<string, string>
          | undefined;
        const sessionId = data?.sessionId;
        const rawTitle =
          notification.request.content.title || "New notification";
        const title = rawTitle.replace(/^\[.*?\]\s*/, "").trim() || "New notification";
        const body = notification.request.content.body || undefined;

        toast(
          title,
          "default",
          7000,
          "top",
          true,
          sessionId
            ? {
                label: "View on calendar",
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
                    toast(
                      "That item isn't on your calendar anymore.",
                      "destructive",
                    );
                  }
                },
              }
            : undefined,
          { description: body },
        );
      },
    );

    return () => {
      subResponse.remove();
      subForeground.remove();
    };
  }, [router, toast]);
}

