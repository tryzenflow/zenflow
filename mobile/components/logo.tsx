import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/motion";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";

const GLOW = {
  borderRadius: 999,
  backgroundColor: "#F0B100",
  shadowColor: "#FF6900",
  shadowOpacity: 0.4,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 10,
} as const;

/**
 * Zenflow sunrise mark — ported from frontend/src/components/logo.tsx (react-native-svg
 * instead of inline <svg>; no CSS hover/breathe animation on native, static mark).
 */
export function Logo({
  className,
  glow = false,
  breathe = false,
}: {
  className?: string;
  /** Orange drop shadow, as in mockups/login.html (`shadow-lg shadow-brand-orange/30`). */
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

  return (
    <View
      className={cn("aspect-square", className)}
      // A shadow needs an opaque layer to be cast from: the mark's own circle
      // is vector content, so back it with a matching disc. It sits behind the
      // mark in its own layer so `breathe` can fade just the glow.
      style={glow && !breathe ? GLOW : undefined}
    >
      {glow && breathe && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, GLOW, glowStyle]}
        />
      )}
      <Svg viewBox="0 0 260 260" width="100%" height="100%" fill="none">
        <Circle cx={130} cy={130} r={130} fill="url(#zenflow-sunrise)" />
        <Path
          d="M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5"
          stroke="#FFF085"
          strokeWidth={24}
          strokeLinecap="round"
        />
        <Defs>
          <LinearGradient
            id="zenflow-sunrise"
            x1={48.5}
            y1={31.5}
            x2={222.5}
            y2={220.5}
            gradientUnits="userSpaceOnUse"
          >
            <Stop stopColor="#FF6900" offset={0} />
            <Stop stopColor="#F0B100" offset={0.323567} />
            <Stop stopColor="#D8F999" offset={1} />
          </LinearGradient>
        </Defs>
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
