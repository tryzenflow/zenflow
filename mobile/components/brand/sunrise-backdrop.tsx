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
 * Login / boot backdrop: an aurora of the logo's own gradient. Four soft blobs
 * (orange, amber, lime, peach) overlap and drift out of phase, so the colours
 * keep blending into each other. No shapes, no lines; just light.
 *
 * `energy="lively"` (login, boot screen) gives every blob independent X / Y
 * cycles so it travels in slow loops, pulses its glow, and adds a sweep of
 * sunrise colour that cross-fades underneath. `calm` (the default, used behind
 * forms) is the original gentle one-axis drift.
 * Paused under Reduce Motion. Decorative only.
 */
export type BackdropEnergy = "calm" | "lively";

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
  { id: "orange", color: "#FF6900", x: 0.12, y: 0.86, size: 0.95, alpha: [0.18, 0.16], dx: 150, dy: -110, ms: 7000 },
  { id: "amber", color: "#F0B100", x: 0.88, y: 0.62, size: 0.8, alpha: [0.15, 0.14], dx: -130, dy: 100, ms: 9000 },
  { id: "lime", color: "#D8F999", x: 0.9, y: 0.06, size: 0.85, alpha: [0.3, 0.12], dx: -120, dy: 130, ms: 11000 },
  { id: "peach", color: "#FFA66B", x: 0.05, y: 0.14, size: 0.7, alpha: [0.16, 0.12], dx: 130, dy: 90, ms: 8000 },
];

// Lively multipliers: wider travel, brighter core, Y cycle out of step with X.
const LIVELY_TRAVEL = 1.8;
const LIVELY_ALPHA = 1.7;
const LIVELY_Y_RATIO = 1.37;

function pingPong(ms: number) {
  return withRepeat(
    withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }),
    -1,
    true,
  );
}

function BlobLayer({
  blob,
  dark,
  intensity,
  lively,
}: {
  blob: Blob;
  dark: boolean;
  intensity: number;
  lively: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      tx.value = 0;
      ty.value = 0;
      pulse.value = 0;
      return;
    }
    tx.value = pingPong(blob.ms);
    ty.value = pingPong(lively ? blob.ms * LIVELY_Y_RATIO : blob.ms);
    pulse.value = lively ? pingPong(blob.ms * 0.6) : 0;
  }, [reduceMotion, lively, blob.ms, tx, ty, pulse]);

  const travel = lively ? LIVELY_TRAVEL : 1;
  const d = Math.max(width, height) * blob.size;
  const style = useAnimatedStyle(() => ({
    opacity: lively ? 1 - 0.35 * pulse.value : 1,
    transform: [
      { translateX: blob.dx * travel * tx.value },
      { translateY: blob.dy * travel * ty.value },
      { scale: 1 + (lively ? 0.28 : 0.18) * tx.value },
    ],
  }));

  const peak = Math.min(
    blob.alpha[dark ? 1 : 0] * intensity * (lively ? LIVELY_ALPHA : 1),
    0.6,
  );

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
            <Stop offset="0" stopColor={blob.color} stopOpacity={peak} />
            <Stop offset="0.5" stopColor={blob.color} stopOpacity={peak * 0.4} />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill={`url(#zf-${blob.id})`} />
      </Svg>
    </Animated.View>
  );
}

/** Two sunrise washes; the second cross-fades over the first and back. */
const SWEEP = {
  light: {
    a: ["#FFA66B33", "#FFA66B00", "#D8F99940"],
    b: ["#F0B10040", "#F0B10000", "#FF690028"],
  },
  dark: {
    a: ["#FF690024", "#FF690000", "#D8F99914"],
    b: ["#F0B10024", "#F0B10000", "#FFA66B1C"],
  },
} as const;

function SunriseSweep({ dark }: { dark: boolean }) {
  const reduceMotion = useReducedMotion();
  const fade = useSharedValue(0);

  useEffect(() => {
    fade.value = 0;
    if (!reduceMotion) {
      fade.value = withRepeat(
        withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    }
  }, [reduceMotion, fade]);

  const topStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const palette = SWEEP[dark ? "dark" : "light"];

  return (
    <>
      <LinearGradient
        colors={[...palette.a]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[StyleSheet.absoluteFill, topStyle]}>
        <LinearGradient
          colors={[...palette.b]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </>
  );
}

/** `intensity` scales every glow (1 = login; the form screens use less so content stays calm). */
export function SunriseBackdrop({
  dark = false,
  intensity = 1,
  energy = "calm",
}: {
  dark?: boolean;
  intensity?: number;
  energy?: BackdropEnergy;
}) {
  const lively = energy === "lively";
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {lively && <SunriseSweep dark={dark} />}
      {BLOBS.map((b) => (
        <BlobLayer
          key={b.id}
          blob={b}
          dark={dark}
          intensity={intensity}
          lively={lively}
        />
      ))}
    </View>
  );
}
