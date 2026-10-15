import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { CalendarDays } from "@/components/Icons";
import { GlassButton } from "@/components/ui/glass-button";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { View } from "react-native";
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
      <GlassButton
        icon={CalendarDays}
        onPress={onPress}
        accessibilityLabel={t("Jump to today")}
      >
        {t("Today")}
      </GlassButton>
    </Animated.View>
  );
}
