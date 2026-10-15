import { Logo } from "@/components/logo";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { Text } from "@/components/ui/text";
import { bootHints } from "@/lib/boot-hints";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { DURATION, useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
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

/** Shown for at least this long, so a fast launch doesn't flash and vanish. */
const MIN_VISIBLE_MS = 1200;
const SLOW_AFTER_MS = 3000;
const HINT_EVERY_MS = 3200;
/** Logo is the splash image's mark: 560 of its 1024px, at `imageWidth` 160 (560/1024 of 160 is 88). */
const LOGO_SIZE = 88;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

// Half-ellipse "sky" the sun travels along.
const ARC_W = 120;
const ARC_H = 44;
const ARC_PATH = "M 10 38 A 50 28 0 0 1 110 38";
const ARC_LEN = 128;

/** A little sun rising along an arc, trailing the logo's gradient. */
function SunArc({ animate }: { animate: boolean }) {
  const p = useSharedValue(0.5);

  useEffect(() => {
    if (!animate) {
      p.value = 0.5;
      return;
    }
    p.value = 0;
    p.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
  }, [animate, p]);

  const trail = useAnimatedProps(() => ({
    strokeDashoffset: ARC_LEN * (1 - p.value),
  }));
  const sun = useAnimatedProps(() => {
    const a = Math.PI * p.value;
    return {
      cx: 60 - 50 * Math.cos(a),
      cy: 38 - 28 * Math.sin(a),
      fill: interpolateColor(
        p.value,
        [0, 0.5, 1],
        ["#5B88A6", "#5B88A6", "#E8895E"],
      ),
    };
  });

  return (
    <Svg width={ARC_W} height={ARC_H} viewBox={`0 0 ${ARC_W} ${ARC_H}`}>
      <Defs>
        <LinearGradient id="zf-arc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#5B88A6" />
          <Stop offset="0.5" stopColor="#5B88A6" />
          <Stop offset="1" stopColor="#E8895E" />
        </LinearGradient>
      </Defs>
      <Path
        d={ARC_PATH}
        stroke="#5B88A6"
        strokeOpacity={0.18}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <AnimatedPath
        d={ARC_PATH}
        stroke="url(#zf-arc)"
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${ARC_LEN} ${ARC_LEN}`}
        animatedProps={trail}
      />
      <AnimatedCircle r={5.5} animatedProps={sun} />
    </Svg>
  );
}

/**
 * Our own splash, laid over the app while it starts (session check, route
 * redirect). The native splash hands over to it with the logo in the same spot,
 * then it adds a moving sunrise, a loader and a rotating hint about things you
 * can't see on screen. Lifts once `ready` and the minimum time has passed.
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
  const [slow, setSlow] = useState(false);
  const hints = useMemo(() => bootHints(), []);
  const [hintIndex, setHintIndex] = useState(() =>
    Math.floor(Math.random() * hints.length),
  );

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
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(slowTimer);
    };
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

  useEffect(() => {
    if (slow) return;
    const id = setInterval(
      () => setHintIndex((i) => (i + 1) % hints.length),
      HINT_EVERY_MS,
    );
    return () => clearInterval(id);
  }, [slow, hints.length]);

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

  const hint = slow ? t("Taking longer than usual…") : hints[hintIndex];

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[StyleSheet.absoluteFill, rootStyle, { zIndex: 100 }]}
      className="bg-background"
    >
      {/* Softer than login: the hint text sits right on it and must stay readable. */}
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
        <Logo glow breathe className="h-[88px] w-[88px] rounded-full" />
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
            gap: 10,
          },
          lowerStyle,
        ]}
      >
        <Text className="text-[22px] font-semibold tracking-tight">
          Zenflow
        </Text>
        <SunArc animate={!reduceMotion} />
        <View className="min-h-[63px] w-[300px] items-center">
          <Animated.View
            key={hint}
            className="w-full"
            entering={reduceMotion ? undefined : FadeIn.duration(DURATION.slow)}
            exiting={reduceMotion ? undefined : FadeOut.duration(DURATION.fast)}
          >
            <Text className="text-center text-[15px] leading-[21px] text-foreground/80">
              {hint}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
