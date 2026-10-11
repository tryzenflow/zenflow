import { Logo } from "@/components/logo";
import { useReducedMotion } from "@/lib/motion";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/**
 * In-app continuation of the native splash: same ground colour and logo spot,
 * so the handoff is invisible, then the mark breathes while the sunrise glow
 * pulses behind it. Once `done` flips (the native splash has lifted and the
 * first screen has painted) the whole overlay fades out and unmounts.
 */
export function AnimatedSplash({
  dark,
  done,
}: {
  dark: boolean;
  done: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(true);
  const pulse = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduceMotion, pulse]);

  useEffect(() => {
    if (!done) return;
    fade.value = withDelay(
      120,
      withTiming(
        0,
        { duration: 520, easing: Easing.out(Easing.quad) },
        (fin) => {
          if (fin) runOnJS(setMounted)(false);
        },
      ),
    );
  }, [done, fade]);

  const container = useAnimatedStyle(() => ({ opacity: fade.value }));
  const logo = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.05 * pulse.value + 0.12 * (1 - fade.value) }],
  }));
  const glow = useAnimatedStyle(() => ({
    opacity: 0.55 + 0.35 * pulse.value,
    transform: [{ scale: 0.9 + 0.25 * pulse.value }],
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={done ? "none" : "auto"}
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: dark ? "#0F0D0A" : "#FFF7ED" },
        styles.center,
        container,
      ]}
    >
      <Animated.View
        style={[
          styles.glow,
          { backgroundColor: dark ? "#FF7A24" : "#FF8E3E" },
          glow,
        ]}
      />
      <Animated.View style={logo}>
        <Logo className="h-[132px] w-[132px] rounded-full" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", zIndex: 100 },
  glow: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    opacity: 0.2,
  },
});
