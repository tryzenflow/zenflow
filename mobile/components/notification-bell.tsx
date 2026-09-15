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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const unread = useNotificationsStore((s) => s.unreadCount);

  return (
    <Pressable
      onPress={() => router.push("/notifications" as Href)}
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
      hitSlop={10}
      style={{ top: insets.top + 8 }}
      className="absolute right-4 z-20 h-9 w-9 items-center justify-center rounded-full border border-border bg-background/85"
    >
      <Bell size={17} className="text-foreground" />
      {unread > 0 && (
        <View className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background bg-destructive" />
      )}
    </Pressable>
  );
}

