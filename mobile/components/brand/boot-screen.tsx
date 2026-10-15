import { Logo } from "@/components/logo";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { DURATION, useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

/** Shown for at least this long, so a fast launch doesn't flash and vanish. */
const MIN_VISIBLE_MS = 1800;
/** Logo is the splash image's mark: 560 of its 1024px, at `imageWidth` 160 (560/1024 of 160 is 88). */
const LOGO_SIZE = 88;

/**
 * Our own splash, laid over the app while it starts (session check, route
 * redirect). The native splash hands over to it with the logo in the same spot,
 * then the logo's curve spins as the loader. Lifts once `ready` and the minimum
 * time has passed.
 */
export function BootScreen({
  ready,
  onShown,
  onDone,
}: {
  ready: boolean;
  /** Called once this screen has painted, so the native splash can lift without a blank frame. */
  onShown: () => void;
  onDone: () => void;
}) {
  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const [shown, setShown] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const intro = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    intro.value = withDelay(
      reduceMotion ? 0 : 120,
      withTiming(1, {
        duration: reduceMotion ? 0 : DURATION.slow * 2,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [intro, reduceMotion]);

  // Timers run from the first painted frame, not from mount: the native splash
  // is still covering us until then, so counting earlier would shorten what the
  // user actually sees and let a fast launch flash straight past.
  useEffect(() => {
    if (!shown) return;
    const min = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(min);
  }, [shown]);

  // Painted = laid out, then two frames for the backdrop's SVG to rasterise.
  const shownOnce = useRef(false);
  const handleLayout = useCallback(() => {
    if (shownOnce.current) return;
    shownOnce.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setShown(true);
        onShown();
      }),
    );
  }, [onShown]);

  // Lift only once the app underneath has had two frames to paint, so the
  // fade reveals a drawn screen instead of a blank one.
  useEffect(() => {
    if (!(ready && minElapsed)) return;
    let cancelled = false;
    let raf2 = 0;
    const lift = () => {
      if (cancelled) return;
      exit.value = withTiming(
        1,
        {
          duration: reduceMotion ? 150 : DURATION.slow,
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          if (finished) runOnJS(onDone)();
        },
      );
    };
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(lift);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [ready, minElapsed, reduceMotion, exit, onDone]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: reduceMotion ? 1 : 1 + 0.05 * exit.value }],
  }));
  const lowerStyle = useAnimatedStyle(() => ({
    opacity: intro.value,
    transform: [{ translateY: (1 - intro.value) * 14 }],
  }));

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[StyleSheet.absoluteFill, rootStyle, { zIndex: 100 }]}
      className="bg-background"
    >
      <SunriseBackdrop
        dark={isDarkColorScheme}
        energy="lively"
        intensity={0.55}
      />
      {/* Same centre as the native splash image, so the handover doesn't jump. */}
      <View
        pointerEvents="none"
        className="flex-1 items-center justify-center"
      >
        {/* Fixed size: the mark must match the native image (LOGO_SIZE). */}
        <Logo glow breathe spin className="h-[88px] w-[88px] rounded-full" />
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            top: height / 2 + LOGO_SIZE / 2 + 22,
            alignItems: "center",
          },
          lowerStyle,
        ]}
      >
        <Text className="text-[22px] font-semibold tracking-tight">
          Zenflow
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
