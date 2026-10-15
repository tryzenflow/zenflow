import {
  COURSE_SWATCHES,
  SESSION_TINT_ALPHA,
  courseSwatchIndex,
  hexAlpha,
  type Scheme,
} from "@zenflow/core";
import type { CourseColour } from "@zenflow/shared";

/** Raw colours a session paints with when it has a course. */
export interface CourseStyle {
  /** Block or pill fill: the swatch at 12% light, 22% dark. */
  tint: string;
  /** Stripe and dot. */
  stripe: string;
  /** Text on the tint, AA per scheme. */
  ink: string;
}

/** The user's picks as a `courseKey -> swatch index` map. */
export function overridesOf(
  colours: readonly CourseColour[],
): Map<string, number> {
  return new Map(colours.map((c) => [c.courseKey, c.swatch]));
}

/**
 * The course colour for a session, or `null` when it belongs to no course
 * (the caller then falls back to the type tone).
 */
export function courseStyleFor(
  courseKey: string | null,
  overrides: ReadonlyMap<string, number>,
  scheme: Scheme,
): CourseStyle | null {
  if (!courseKey) return null;
  const swatch = COURSE_SWATCHES[courseSwatchIndex(courseKey, overrides)];
  return {
    tint: hexAlpha(swatch.base, SESSION_TINT_ALPHA[scheme]),
    stripe: swatch.base,
    ink: swatch.ink[scheme],
  };
}
