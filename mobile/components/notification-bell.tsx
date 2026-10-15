import { t } from "@/lib/i18n";
import { navigateOnce } from "@/lib/nav";
import { useLanguage } from "@/hooks/use-language";
import { Bell } from "@/components/Icons";
import { GlassButton } from "@/components/ui/glass-button";
import { useNotificationsStore } from "@/hooks/use-notifications";
import { type Href, useRouter } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Floating bell button that opens the notification inbox (`app/notifications.tsx`)
 * and shows an unread indicator driven live by the SSE stream. Rendered top-right,
 * overlaying the calendar header so the gesture-heavy `WeekHeader` doesn't need to host it.
 * Web counterpart: `frontend/src/components/notifications/notification-bell.tsx`.
 */
export function NotificationBell() {
  useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const unread = useNotificationsStore((s) => s.unreadCount);

  return (
    <GlassButton
      icon={Bell}
      onPress={() => navigateOnce(() => router.push("/notifications" as Href))}
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : t("Notifications")
      }
      badge={
        unread > 0 ? (
          <View className="h-2.5 w-2.5 rounded-full border border-background bg-destructive" />
        ) : null
      }
      style={{ position: "absolute", right: 12, top: insets.top + 6, zIndex: 20 }}
    />
  );
}
