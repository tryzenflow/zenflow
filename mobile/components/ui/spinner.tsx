import { NAV_THEME } from "@/lib/constants";
import { useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

type Tone = "primary" | "onPrimary" | "muted";

/** The logo's middle curve (mobile/components/logo.tsx). */
const CURVE =
  "M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5";
const LOOP_MS = 1600;
/** Share of the loop spent turning; the rest holds at rest. */
const TURN = 0.72;
const swirl = Easing.bezierFn(0.72, 0, 0.22, 1);

export type SwirlLayer = { lag: number; opacity: number; width: number };

/** Lead curve first, then trails that lag further, fade and thin. */
const LAYERS: readonly SwirlLayer[] = [
  { lag: 0, opacity: 1, width: 34 },
  { lag: 0.022, opacity: 0.55, width: 32 },
  { lag: 0.044, opacity: 0.4, width: 28 },
  { lag: 0.066, opacity: 0.28, width: 24 },
  { lag: 0.088, opacity: 0.18, width: 20 },
];

function CurveLayer({
  progress,
  lag,
  opacity,
  width,
  color,
}: {
  progress: SharedValue<number>;
  lag: number;
  opacity: number;
  width: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const t = (progress.value - lag + 1) % 1;
    const turn = t >= TURN ? 1 : swirl(t / TURN);
    return { transform: [{ rotate: `${turn * 360}deg` }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }, style]}>
      <Svg viewBox="0 0 260 260" width="100%" height="100%" fill="none">
        <Path d={CURVE} stroke={color} strokeWidth={width} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

/**
 * The logo curve turning once per loop with fading trails, filling its parent.
 * With `animate` off it draws the lead curve only, at rest.
 */
export function CurveSwirl({
  color,
  layers = LAYERS,
  animate = true,
}: {
  color: string;
  layers?: readonly SwirlLayer[];
  animate?: boolean;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    if (animate) {
      progress.value = withRepeat(
        withTiming(1, { duration: LOOP_MS, easing: Easing.linear }),
        -1,
      );
    }
    return () => cancelAnimation(progress);
  }, [animate, progress]);
  const shown = animate ? layers : layers.slice(0, 1);
  return (
    <>
      {[...shown].reverse().map((l) => (
        <CurveLayer key={l.lag} progress={progress} color={color} {...l} />
      ))}
    </>
  );
}

/**
 * Loading mark: the logo curve turns once, eases to rest and drags fading
 * trails behind it (mockups/brand-loader.html). Under Reduce Motion it holds
 * still and fades. `color` overrides the tone for fixed-colour surfaces.
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
  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = 1;
    if (reduceMotion) {
      fade.value = withRepeat(
        withTiming(0.55, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    }
    return () => cancelAnimation(fade);
  }, [reduceMotion, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const ink =
    color ??
    (tone === "onPrimary"
      ? "#2B1406"
      : tone === "muted"
        ? theme.mutedForeground
        : theme.primary);
  return (
    <Animated.View
      testID={testID}
      accessibilityRole="progressbar"
      style={[{ width: size, height: size }, fadeStyle]}
    >
      <CurveSwirl color={ink} animate={!reduceMotion} />
    </Animated.View>
  );
}
