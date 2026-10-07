import { useMemo } from "react";
import {
  FadeIn,
  FadeInDown,
  FadeOut,
  ZoomIn,
  useReducedMotion,
} from "react-native-reanimated";

export { useReducedMotion };

/**
 * Reduce Motion in one place for `components/ui`. Spatial and looping motion
 * goes static or instant; fades that confirm a state change stay (short).
 *
 * - `duration(ms)`: `0` under Reduce Motion, else `ms` (for `withTiming`).
 * - `fade(ms)`: `entering`/`exiting` props for an overlay or message.
 * - `pop(ms)`: a gentle scale-in for a small confirmation (a check mark); fade only when reduced.
 * - `rise(ms)`: like `fade` but the entrance also slides in; opacity only when reduced.
 */
export function useMotion() {
  const reduced = useReducedMotion();
  return useMemo(
    () => ({
      reduced,
      duration: (ms: number) => (reduced ? 0 : ms),
      fade: (ms = 150) => ({
        entering: FadeIn.duration(reduced ? 100 : ms),
        exiting: FadeOut.duration(reduced ? 80 : ms),
      }),
      pop: (ms = 320) => ({
        entering: reduced ? FadeIn.duration(100) : ZoomIn.duration(ms),
      }),
      rise: (ms = 250) => ({
        entering: (reduced ? FadeIn.duration(100) : FadeInDown.duration(ms)),
        exiting: FadeOut.duration(reduced ? 80 : ms),
      }),
    }),
    [reduced],
  );
}
