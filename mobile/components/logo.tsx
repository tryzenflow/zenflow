import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/motion";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";

/** App icon tile: corner radius is 58 of 256. */
const TILE_RADIUS = 58 / 256;

const GLOW = {
  backgroundColor: "#FBF5EC",
  shadowColor: "#5B88A6",
  shadowOpacity: 0.4,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 10,
} as const;

/**
 * Zenflow sunrise mark on the app icon tile, same drawing as landing/public/favicon.svg
 * (react-native-svg instead of inline <svg>).
 */
export function Logo({
  className,
  glow = false,
  breathe = false,
}: {
  className?: string;
  /** Slate drop shadow under the mark. */
  glow?: boolean;
  /** Slowly swell the glow (needs `glow`). Static under Reduce Motion. */
  breathe?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const swell = useSharedValue(1);
  useEffect(() => {
    swell.value = 1;
    if (glow && breathe && !reduceMotion) {
      swell.value = withRepeat(
        withTiming(0.45, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    }
  }, [glow, breathe, reduceMotion, swell]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: swell.value }));
  const [side, setSide] = useState(0);
  const radius = { borderRadius: side * TILE_RADIUS };

  return (
    <View
      className={cn("aspect-square", className)}
      // A shadow needs an opaque layer to be cast from: the mark's own circle
      // is vector content, so back it with a matching disc. It sits behind the
      // mark in its own layer so `breathe` can fade just the glow.
      style={glow && !breathe ? [GLOW, radius] : undefined}
      onLayout={(e) => setSide(e.nativeEvent.layout.width)}
    >
      {glow && breathe && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, GLOW, radius, glowStyle]}
        />
      )}
      <Svg viewBox="0 0 256 256" width="100%" height="100%" fill="none">
        <Rect width={256} height={256} rx={58} fill="#FBF5EC" />
        <Path
          d="M52 166 A76 76 0 0 1 204 166"
          stroke="#E8895E"
          strokeWidth={20}
          strokeLinecap="round"
        />
        <Path d="M100 166 A28 28 0 0 1 156 166 Z" fill="#E8895E" />
        <Rect x={40} y={180} width={176} height={14} rx={7} fill="#5B88A6" />
        <Rect x={64} y={204} width={128} height={8} rx={4} fill="#5B88A6" opacity={0.35} />
      </Svg>
    </View>
  );
}

/** Logo + "Zenflow" wordmark lockup. */
export function Wordmark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <View className={cn("flex-row items-center gap-2", className)}>
      <Logo className={cn("h-9 w-9 shrink-0", iconClassName)} />
      <Text className="text-xl font-semibold tracking-tight">Zenflow</Text>
    </View>
  );
}
