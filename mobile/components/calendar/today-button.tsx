import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { CalendarDays } from "@/components/Icons";
import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import * as Haptics from "expo-haptics";
import { View } from "react-native";
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
  useLanguage();
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
      <View
        style={{
          borderRadius: 9999,
          shadowColor: "#000",
          shadowOpacity: 0.14,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
        }}
      >
        <Glass radius={9999} clear intensity={40}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("Jump to today")}
            className="flex-row items-center gap-1.5 px-4 py-2.5 active:opacity-80"
          >
            <CalendarDays size={16} className="text-foreground" />
            <Text className="text-[13px] font-semibold">{t("Today")}</Text>
          </Pressable>
        </Glass>
      </View>
    </Animated.View>
  );
}
