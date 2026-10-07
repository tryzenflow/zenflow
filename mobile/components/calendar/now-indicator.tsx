import { useLanguage } from "@/hooks/use-language";
import { DAILY_HORIZON } from "@zenflow/core";
import { toZonedTime } from "date-fns-tz";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

interface NowIndicatorProps {
  now: Date;
  tz: string;
  totalHeight: number;
  /** Pulse only while this page is the one on screen. */
  active?: boolean;
}

const DOT = 10;
const RING = 22;

/**
 * "You are here": one dot, a solid 2px line (accessible orange, 5:1 on the grid
 * in light mode) and a slow ring that breathes around the dot. The ring holds
 * still under Reduce Motion or when the page is off-screen.
 */
export function NowIndicator({
  now,
  tz,
  totalHeight,
  active = true,
}: NowIndicatorProps) {
  useLanguage();
  const reduced = useReducedMotion();
  const zoned = toZonedTime(now, tz);
  const mins = zoned.getHours() * 60 + zoned.getMinutes();
  const top = (mins / DAILY_HORIZON) * totalHeight;

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.out(Easing.cubic) }),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [reduced, active, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0.35 : 0.55 * (1 - pulse.value),
    transform: [{ scale: reduced ? 1 : 0.55 + pulse.value * 0.45 }],
  }));

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="absolute inset-x-0 z-20"
      style={{ top }}
    >
      <View
        className="absolute h-[2px] w-full bg-primary-text"
        style={{ top: -1 }}
      />
      <Animated.View
        className="absolute rounded-full border border-primary-text"
        style={[
          { width: RING, height: RING, left: -RING / 2, top: -RING / 2 },
          ringStyle,
        ]}
      />
      <View
        className="absolute rounded-full bg-primary-text"
        style={{ width: DOT, height: DOT, left: -DOT / 2, top: -DOT / 2 }}
      />
    </View>
  );
}
