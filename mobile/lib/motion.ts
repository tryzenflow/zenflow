import { Easing, useReducedMotion, withSpring, withTiming } from "react-native-reanimated";

/**
 * Sunrise Flow motion presets (docs/mobile/design.md). Every animation in the
 * app picks from here rather than inventing durations: springs for anything
 * the finger can interrupt, short eased timings for fades.
 */
export const SPRING = {
  /** Selection pills, tab indicator: quick, no visible overshoot. */
  snappy: { damping: 22, stiffness: 260, mass: 0.9 },
  /** Page slides and sheets: a touch softer, still settles under 300 ms. */
  flow: { damping: 26, stiffness: 210, mass: 1 },
} as const;

export const DURATION = { fast: 140, base: 200, slow: 280 } as const;

export const EASE_OUT = Easing.out(Easing.cubic);

/** Spring toward `to`, or jump there when the user asked for reduced motion. */
export function springTo(
  to: number,
  reduce: boolean,
  config: (typeof SPRING)[keyof typeof SPRING] = SPRING.snappy,
) {
  "worklet";
  return reduce ? to : withSpring(to, config);
}

/** Eased timing toward `to`, or an instant jump under reduced motion. */
export function timeTo(to: number, reduce: boolean, ms: number = DURATION.base) {
  "worklet";
  return reduce ? to : withTiming(to, { duration: ms, easing: EASE_OUT });
}

export { useReducedMotion };
