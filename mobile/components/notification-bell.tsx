import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { Bell } from "@/components/Icons";
import { useNotificationsStore } from "@/hooks/use-notifications";
import { type Href, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
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
    <Pressable
      onPress={() => router.push("/notifications" as Href)}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0
          ? `${t("Notifications")}, ${t("{count} unread", { count: unread })}`
          : t("Notifications")
      }
      hitSlop={10}
      style={{ top: insets.top + 8 }}
      className="absolute right-4 z-20 h-9 w-9 items-center justify-center rounded-full border border-border bg-background/85"
    >
      <Bell size={17} className="text-foreground" />
      {unread > 0 && (
        <View className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-primary-text" />
      )}
    </Pressable>
  );
}
