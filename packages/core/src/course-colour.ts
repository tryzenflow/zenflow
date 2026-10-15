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
 * The 12 course colours, in picker order. Sand and slate family hues; no
 * violet, no blue-violet and no red (cherry is reserved for late work).
 */
export const COURSE_SWATCHES: readonly CourseSwatch[] = [
  { base: "#2F6F85", ink: { light: "#2E6C81", dark: "#8DABB0" } },
  { base: "#5B88A6", ink: { light: "#476B83", dark: "#99B1BD" } },
  { base: "#2E7D7A", ink: { light: "#2A6F6E", dark: "#89B0A8" } },
  { base: "#7DA886", ink: { light: "#516F5F", dark: "#A1BDA1" } },
  { base: "#8C9A4E", ink: { light: "#606D41", dark: "#B0B680" } },
  { base: "#D9A23E", ink: { light: "#7E6735", dark: "#DEB15E" } },
  { base: "#E8895E", ink: { light: "#8E5D48", dark: "#EBA481" } },
  { base: "#C0643F", ink: { light: "#98543A", dark: "#D59C81" } },
  { base: "#E3A98A", ink: { light: "#7D665A", dark: "#E5B194" } },
  { base: "#8A6A4F", ink: { light: "#7B614A", dark: "#B9A48F" } },
  { base: "#8FA3AD", ink: { light: "#5B6C75", dark: "#ADB9BC" } },
  { base: "#5E6E77", ink: { light: "#586770", dark: "#A3A8A7" } },
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
  return overrides.get(key) ?? courseKeyHash(key) % COURSE_SWATCH_COUNT;
}
