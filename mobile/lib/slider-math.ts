/**
 * Pure maths for the direct-manipulation pickers (`DurationSlider`,
 * `TimelineTimePicker`). Values snap to a grid starting at `min`, so a drag
 * and a ±step tap always land on the same values.
 */

/** Clamp `value` to `[min, max]`, then snap it to the nearest `min + k * step`. */
export function snapToStep(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  // Snapping can overshoot `max` when the range is not a whole number of steps.
  return Math.min(max, min + steps * step);
}

/** The value under horizontal position `x` on a track `width` pixels wide. */
export function valueAtX(
  x: number,
  width: number,
  min: number,
  max: number,
  step: number,
): number {
  if (width <= 0) return min;
  const ratio = Math.min(1, Math.max(0, x / width));
  return snapToStep(min + ratio * (max - min), min, max, step);
}

/** Position of `value` along a track, as a 0 to 1 fraction. */
export function fractionOf(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Minutes of day as zero-padded `HH:mm`. */
export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
