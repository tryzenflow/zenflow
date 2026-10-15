import type { Scheme } from "./palette";

/**
 * One course colour: the stripe and dot `base`, and the text `ink` read on the
 * 12% (light) or 22% (dark) tint. Every `ink` is AA (4.5:1) on both tints of
 * its scheme; `course-colour.spec.ts` keeps that true.
 */
export interface CourseSwatch {
  base: string;
  ink: Record<Scheme, string>;
}

/** The 12 course colours, in picker order. */
export const COURSE_SWATCHES: readonly CourseSwatch[] = [
  { base: "#2F80ED", ink: { light: "#153A6B", dark: "#C7DDFA" } },
  { base: "#7B61FF", ink: { light: "#3B2F7B", dark: "#E8E3FF" } },
  { base: "#D6336C", ink: { light: "#6A1936", dark: "#FCF1F5" } },
  { base: "#E8590C", ink: { light: "#692805", dark: "#FEF7F3" } },
  { base: "#F2A900", ink: { light: "#563C00", dark: "#FFFEFD" } },
  { base: "#2F9E44", ink: { light: "#15451E", dark: "#CDE8D2" } },
  { base: "#0CA678", ink: { light: "#054532", dark: "#C5EADF" } },
  { base: "#1098AD", ink: { light: "#07434C", dark: "#C2E5EA" } },
  { base: "#A61E4D", ink: { light: "#691331", dark: "#F5E7EC" } },
  { base: "#5C7CFA", ink: { light: "#2A3871", dark: "#DAE2FE" } },
  { base: "#94D82D", ink: { light: "#31480F", dark: "#F2FAE5" } },
  { base: "#B5179E", ink: { light: "#650D59", dark: "#F8E9F6" } },
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
