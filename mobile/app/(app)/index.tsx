import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Calendar } from "@/components/Icons";

export default function DayScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-8">
      <Calendar size={32} className="text-muted-foreground" />
      <Text className="text-center text-lg font-semibold">Day view</Text>
      <Text className="text-center text-sm text-muted-foreground">
        The gesture-first calendar timeline lands in a follow-up session (see
        docs/react-native-migration.md Phase 2).
      </Text>
    </View>
  );
}
