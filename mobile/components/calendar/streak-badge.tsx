import { Flame } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useTodayStore } from "@/hooks/use-today";
import { t } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/** The logo's orange. */
const FLAME_ORANGE = "#FF6900";

/** A lit flame: it flickers and sways, with a glow that swells and fades behind it. */
function BurningFlame() {
  const reduceMotion = useReducedMotion();
  const heat = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    heat.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 340, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.8, { duration: 280, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 460, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [reduceMotion, heat]);

  const flame = useAnimatedStyle(() => ({
    transform: [
      { translateY: 11 },
      { scaleY: 1 + 0.14 * heat.value },
      { scaleX: 1 - 0.05 * heat.value },
      { rotate: `${(heat.value - 0.5) * 6}deg` },
      { translateY: -11 },
    ],
  }));
  const glow = useAnimatedStyle(() => ({
    opacity: 0.18 + 0.3 * heat.value,
    transform: [{ scale: 0.9 + 0.5 * heat.value }],
  }));

  return (
    <View className="size-[22px] items-center justify-center">
      <Animated.View
        pointerEvents="none"
        className="absolute size-[22px] rounded-full"
        style={[{ backgroundColor: FLAME_ORANGE }, glow]}
      />
      <Animated.View style={flame}>
        <Flame size={22} color={FLAME_ORANGE} fill={FLAME_ORANGE} />
      </Animated.View>
    </View>
  );
}

/** Task streak next to the search button. A burning orange flame while the streak is 1 or more, a grey outline at 0. */
export function StreakBadge() {
  useLanguage();
  const count = useTodayStore((s) => s.streak?.current ?? 0);
  const lit = count >= 1;

  return (
    <View
      testID="calendar-header.streak"
      accessibilityLabel={t("{count} day streak", { count })}
      className="h-11 flex-row items-center gap-1 rounded-full px-1"
    >
      {lit ? (
        <BurningFlame />
      ) : (
        <Flame size={22} className="text-muted-foreground" fill="none" />
      )}
      <Text
        className={
          lit
            ? "text-[16px] font-bold"
            : "text-[16px] font-bold text-muted-foreground"
        }
      >
        {count}
      </Text>
    </View>
  );
}
