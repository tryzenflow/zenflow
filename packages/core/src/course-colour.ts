import type { Scheme } from "./palette";

/**
 * One course colour: the stripe and dot `base`, and the text `ink` read on the
 * 12% (light) or 22% (dark) tint. Every `ink` is AA (4.5:1) on both tints of
 * its scheme; `mobile/lib/__tests__/course-colour.test.ts` keeps that true.
 */
export interface CourseSwatch {
  base: string;
  ink: Record<Scheme, string>;
}

/**
 * The 6 course colours, in picker order. Each is far from the type tones that
 * carry meaning: no orange (tasks), no grey (do not disturb), no red (late),
 * no green (done).
 */
export const COURSE_SWATCHES: readonly CourseSwatch[] = [
  { base: "#3B82C4", ink: { light: "#245C94", dark: "#8FBDE8" } },
  { base: "#14A09B", ink: { light: "#0E6F6B", dark: "#6FD3CD" } },
  { base: "#8DB63C", ink: { light: "#4F6B14", dark: "#C7E27B" } },
  { base: "#F2B33D", ink: { light: "#7A5A00", dark: "#F6C93C" } },
  { base: "#E0567A", ink: { light: "#A12A4B", dark: "#F29BB2" } },
  { base: "#6B7C8C", ink: { light: "#4A5865", dark: "#AEBBC7" } },
];

export const COURSE_SWATCH_COUNT = COURSE_SWATCHES.length;

/** FNV-1a 32-bit hash of a course key, as an unsigned int. */
export function courseKeyHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The swatch index a course paints with: the user's pick when set, otherwise
 * the automatic colour, which is the course key's hash slot. The same key gets
 * the same colour on every device.
 */
export function courseSwatchIndex(
  key: string,
  overrides: ReadonlyMap<string, number>,
): number {
  // Picks saved when there were 12 swatches wrap into the 6 that remain.
  return (
    (overrides.get(key) ?? courseKeyHash(key)) % COURSE_SWATCH_COUNT
  );
}
