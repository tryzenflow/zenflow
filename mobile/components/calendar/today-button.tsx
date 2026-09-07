import { CalendarDays } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

/**
 * Small floating "jump to today" pill, bottom-centre — above the floating
 * tab-bar pill and clear of the bottom-right create FAB. Shown by the Week /
 * Month screens only while today isn't the day / month currently in view.
 */
export function TodayButton({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  const tabBarOverlay = useTabBarOverlayHeight();
  if (!visible) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: tabBarOverlay + 8,
        alignItems: "center",
        zIndex: 34,
      }}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel="Jump to today"
        className="flex-row items-center gap-1.5 rounded-full border border-border bg-background/95 px-3.5 py-2 shadow-sm active:opacity-80"
      >
        <CalendarDays size={14} className="text-foreground" />
        <Text className="text-[12.5px] font-semibold">Today</Text>
      </Pressable>
    </Animated.View>
  );
}
