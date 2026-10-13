import { Logo } from "@/components/logo";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { Text } from "@/components/ui/text";
import { bootHints } from "@/lib/boot-hints";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { DURATION, useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import { useEffect, useMemo, useState } from "react";
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
/** Logo is the splash image's mark: 560 of its 1024px, at `imageWidth` 220. */
const LOGO_SIZE = 120;

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
        ["#FF6900", "#F0B100", "#D8F999"],
      ),
    };
  });

  return (
    <Svg width={ARC_W} height={ARC_H} viewBox={`0 0 ${ARC_W} ${ARC_H}`}>
      <Defs>
        <LinearGradient id="zf-arc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FF6900" />
          <Stop offset="0.5" stopColor="#F0B100" />
          <Stop offset="1" stopColor="#D8F999" />
        </LinearGradient>
      </Defs>
      <Path
        d={ARC_PATH}
        stroke="#F0B100"
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
  onDone,
}: {
  ready: boolean;
  onDone: () => void;
}) {
  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
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
    const min = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(slowTimer);
    };
  }, [intro, reduceMotion]);

  useEffect(() => {
    if (slow) return;
    const id = setInterval(
      () => setHintIndex((i) => (i + 1) % hints.length),
      HINT_EVERY_MS,
    );
    return () => clearInterval(id);
  }, [slow, hints.length]);

  useEffect(() => {
    if (!(ready && minElapsed)) return;
    exit.value = withTiming(
      1,
      { duration: reduceMotion ? 150 : DURATION.slow, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
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
      style={[StyleSheet.absoluteFill, rootStyle, { zIndex: 100 }]}
      className="bg-background"
    >
      <SunriseBackdrop dark={isDarkColorScheme} energy="lively" />
      {/* Same centre as the native splash image, so the handover doesn't jump. */}
      <View
        pointerEvents="none"
        className="flex-1 items-center justify-center"
      >
        {/* Fixed size: the mark must match the native image (LOGO_SIZE). */}
        <Logo glow breathe className="h-[120px] w-[120px] rounded-full" />
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
        <View className="h-[44px] w-[280px] items-center">
          <Animated.View
            key={hint}
            entering={reduceMotion ? undefined : FadeIn.duration(DURATION.slow)}
            exiting={reduceMotion ? undefined : FadeOut.duration(DURATION.fast)}
          >
            <Text className="text-center text-[14px] leading-5 text-muted-foreground">
              {hint}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
