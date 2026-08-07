import { CalendarDays } from "@/components/Icons";
import { CreateTaskFab } from "@/components/tasks/create-task-fab";
import { Text } from "@/components/ui/text";
import { useUserStore } from "@/hooks/use-user-store";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { View } from "react-native";

export default function WeekScreen() {
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const tabBarOverlay = useTabBarOverlayHeight();

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-1 items-center justify-center gap-3 px-8"
        style={{ paddingBottom: tabBarOverlay }}
      >
        <CalendarDays size={32} className="text-muted-foreground" />
        <Text className="text-center text-lg font-semibold">Week view</Text>
        <Text className="text-center text-sm text-muted-foreground">
          The swipeable week pager lands in a follow-up session (see
          docs/react-native-migration.md Phase 3).
        </Text>
      </View>

      <CreateTaskFab tz={tz} />
    </View>
  );
}
