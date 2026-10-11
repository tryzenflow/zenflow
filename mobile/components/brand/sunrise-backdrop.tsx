import { useReducedMotion } from "@/lib/motion";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

/**
 * Login backdrop: an aurora of the logo's own gradient. Four soft blobs
 * (orange, amber, lime, peach) overlap and drift out of phase, so the colours
 * keep blending into each other. No shapes, no lines; just light.
 * Paused under Reduce Motion. Decorative only.
 */
interface Blob {
  id: string;
  color: string;
  /** Centre as a fraction of the screen. */
  x: number;
  y: number;
  /** Diameter as a fraction of the screen's larger side. */
  size: number;
  /** Peak opacity at the core (light, dark). */
  alpha: [number, number];
  /** Drift travel in px and one-way duration in ms. */
  dx: number;
  dy: number;
  ms: number;
}

const BLOBS: Blob[] = [
  { id: "orange", color: "#FF6900", x: 0.12, y: 0.86, size: 0.95, alpha: [0.18, 0.16], dx: 60, dy: -40, ms: 11000 },
  { id: "amber", color: "#F0B100", x: 0.88, y: 0.62, size: 0.8, alpha: [0.15, 0.14], dx: -50, dy: 36, ms: 14000 },
  { id: "lime", color: "#D8F999", x: 0.9, y: 0.06, size: 0.85, alpha: [0.3, 0.12], dx: -44, dy: 50, ms: 17000 },
  { id: "peach", color: "#FFA66B", x: 0.05, y: 0.14, size: 0.7, alpha: [0.16, 0.12], dx: 48, dy: 30, ms: 13000 },
];

function BlobLayer({
  blob,
  dark,
  intensity,
}: {
  blob: Blob;
  dark: boolean;
  intensity: number;
}) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: blob.ms, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduceMotion, blob.ms, t]);

  const d = Math.max(width, height) * blob.size;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: blob.dx * t.value },
      { translateY: blob.dy * t.value },
      { scale: 1 + 0.08 * t.value },
    ],
  }));

  return (
    <Animated.View
      collapsable={false}
      style={[
        {
          position: "absolute",
          width: d,
          height: d,
          left: width * blob.x - d / 2,
          top: height * blob.y - d / 2,
        },
        style,
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`zf-${blob.id}`} cx="50%" cy="50%" r="50%">
            <Stop
              offset="0"
              stopColor={blob.color}
              stopOpacity={blob.alpha[dark ? 1 : 0] * intensity}
            />
            <Stop
              offset="0.5"
              stopColor={blob.color}
              stopOpacity={blob.alpha[dark ? 1 : 0] * 0.4 * intensity}
            />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill={`url(#zf-${blob.id})`} />
      </Svg>
    </Animated.View>
  );
}

const FLOW_COLORS: [string, string, string, string, string] = [
  "#FF8E3E",
  "#F0B100",
  "#FFD9A0",
  "#D8F999",
  "#FFA66B",
];
const FLOW_COLORS_DARK: [string, string, string, string, string] = [
  "#5A2A0C",
  "#4A3406",
  "#2E1A0C",
  "#2A3512",
  "#4E2210",
];

/**
 * A slowly sliding, turning gradient well larger than the screen, so the base
 * colour itself keeps moving under the blobs. Static under Reduce Motion.
 */
function FlowLayer({ dark, intensity }: { dark: boolean; intensity: number }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: 18000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduceMotion, t]);

  const side = Math.max(width, height) * 2.2;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: -width * 0.35 * t.value },
      { translateY: height * 0.18 * t.value },
      { rotate: `${-14 + 28 * t.value}deg` },
    ],
  }));

  return (
    <Animated.View
      collapsable={false}
      style={[
        {
          position: "absolute",
          width: side,
          height: side,
          left: (width - side) / 2,
          top: (height - side) / 2,
          opacity: Math.min(1, (dark ? 0.55 : 0.6) * intensity),
        },
        style,
      ]}
    >
      <LinearGradient
        colors={dark ? FLOW_COLORS_DARK : FLOW_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** `intensity` scales every glow (1 = login; the form screens use less so content stays calm). */
export function SunriseBackdrop({
  dark = false,
  intensity = 1,
}: {
  dark?: boolean;
  intensity?: number;
}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <FlowLayer dark={dark} intensity={intensity} />
      {BLOBS.map((b) => (
        <BlobLayer key={b.id} blob={b} dark={dark} intensity={intensity} />
      ))}
    </View>
  );
}
