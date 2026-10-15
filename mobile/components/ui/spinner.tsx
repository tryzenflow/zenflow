import { NAV_THEME } from "@/lib/constants";
import { useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import { Loader } from "lucide-react-native";
import { useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

type Tone = "primary" | "onPrimary" | "muted";

/**
 * Loading mark. A rotating lucide icon in a theme colour, used instead of the
 * system `ActivityIndicator`, whose fixed grey loses contrast when the theme
 * changes. `color` overrides the tone for fixed-colour surfaces.
 */
export function Spinner({
  size = 20,
  tone = "primary",
  color,
  testID,
}: {
  size?: number;
  tone?: Tone;
  color?: string;
  testID?: string;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const reduceMotion = useReducedMotion();
  const theme = isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light;
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    turn.value = 0;
    turn.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.linear }),
      -1,
    );
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 360}deg` }],
  }));
  const ink =
    color ??
    (tone === "onPrimary"
      ? "#2B1406"
      : tone === "muted"
        ? theme.mutedForeground
        : theme.primary);
  return (
    <Animated.View testID={testID} style={spin} accessibilityRole="progressbar">
      <Loader size={size} color={ink} />
    </Animated.View>
  );
}
