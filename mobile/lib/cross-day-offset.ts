/**
 * Module-level cross-day offset — safe for use in `runOnJS` callbacks
 * referenced by Reanimated worklets. Unlike a `useRef` prop (which
 * Reanimated freezes when it's transitively captured by a worklet), a
 * plain module variable is never intercepted.
 *
 * Only one drag is active at a time, so a singleton is safe.
 */

let _offset = 0;

export const getCrossDayOffset = () => _offset;
export const setCrossDayOffset = (v: number) => { _offset = v; };
export const resetCrossDayOffset = () => { _offset = 0; };
