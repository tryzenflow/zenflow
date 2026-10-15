import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { CalendarDays } from "@/components/Icons";
import { GlassButton } from "@/components/ui/glass-button";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * Small floating "jump to today" pill, bottom-centre — above the floating
 * tab-bar pill and clear of the bottom-right create FAB. Shown by the Week /
 * Month screens only while today isn't the day / month currently in view.
 * The wrapper is always mounted and faded by opacity: inserting or removing it with a layout
 * animation shifts the screen's child indices and Fabric asserts on unmount.
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
  const shown = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: visible ? 160 : 120 });
  }, [visible, shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View
      pointerEvents={visible ? "box-none" : "none"}
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: tabBarOverlay + 8,
          alignItems: "center",
          zIndex: 34,
        },
        fade,
      ]}
    >
      {visible ? (
        <GlassButton
          icon={CalendarDays}
          onPress={onPress}
          accessibilityLabel={t("Jump to today")}
        >
          {t("Today")}
        </GlassButton>
      ) : null}
    </Animated.View>
  );
}
