import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { LayoutGrid } from "@/components/Icons";

export default function MonthScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-8">
      <LayoutGrid size={32} className="text-muted-foreground" />
      <Text className="text-center text-lg font-semibold">Month view</Text>
      <Text className="text-center text-sm text-muted-foreground">
        The paginated month grid lands in a follow-up session (see
        docs/react-native-migration.md Phase 4).
      </Text>
    </View>
  );
}
