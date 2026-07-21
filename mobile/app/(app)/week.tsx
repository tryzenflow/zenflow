import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { CalendarDays } from "@/components/Icons";

export default function WeekScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-8">
      <CalendarDays size={32} className="text-muted-foreground" />
      <Text className="text-center text-lg font-semibold">Week view</Text>
      <Text className="text-center text-sm text-muted-foreground">
        The swipeable week pager lands in a follow-up session (see
        docs/react-native-migration.md Phase 3).
      </Text>
    </View>
  );
}
