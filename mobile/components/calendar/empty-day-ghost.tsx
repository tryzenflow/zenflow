import { Plus } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { FONT_SCALE_CAP } from "@/lib/constants";
import { t } from "@/lib/i18n";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

interface EmptyDayGhostProps {
  top: number;
  height: number;
  left: number;
  right: number;
  /** DLU is connected and syncing cleanly, so "nothing today" can be said plainly. */
  dluClear: boolean;
  /** Breathe only while this page is on screen. */
  active: boolean;
  onPress: () => void;
}

/**
 * The empty day's invitation: a ghost task block at 8:00 that breathes slowly.
 * Tapping it opens the new-task form, never creates anything on its own.
 * Under Reduce Motion it simply rests at full opacity.
 */
export function EmptyDayGhost({
  top,
  height,
  left,
  right,
  dluClear,
  active,
  onPress,
}: EmptyDayGhostProps) {
  useLanguage();
  const reduced = useReducedMotion();
  const breath = useSharedValue(1);
  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(breath);
      breath.value = 1;
      return;
    }
    breath.value = withRepeat(
      withTiming(0.62, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(breath);
  }, [reduced, active, breath]);
  const style = useAnimatedStyle(() => ({ opacity: breath.value }));

  const title = dluClear
    ? t("No classes or deadlines today")
    : t("Nothing planned today");
  const body = t("Add something, Zenflow will pick the time.");

  return (
    <Animated.View
      style={[{ position: "absolute", top, height, left, right }, style]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${body}`}
        accessibilityHint={t("Add a session to this day")}
        className="flex-1 flex-row items-start gap-2.5 rounded-[10px] border-2 border-l-4 border-dashed border-brand-orange/70 border-l-primary bg-brand-orange/10 px-3 py-2 active:bg-brand-orange/20"
      >
        <View className="mt-0.5 size-6 items-center justify-center rounded-full bg-primary">
          <Plus size={14} className="text-primary-foreground" />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
            className="text-sm font-semibold leading-5"
          >
            {title}
          </Text>
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
            className="text-xs leading-4 text-muted-foreground"
          >
            {body}
          </Text>
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP.grid}
            className="mt-0.5 text-xs font-semibold leading-4 text-primary-text"
          >
            {t("Add a task")}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
