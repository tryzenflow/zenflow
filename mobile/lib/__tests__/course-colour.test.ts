import {
  COURSE_SWATCHES,
  SESSION_TINT_ALPHA,
  SURFACES,
  contrastRatio,
  courseKeyHash,
  courseSwatchIndex,
  mixOver,
} from "@zenflow/core";
import type { CourseColour } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { courseStyleFor, overridesOf } from "../course-colour";

const KEY = "lms:90001";

describe("course swatches", () => {
  it("has 12 distinct bases", () => {
    expect(new Set(COURSE_SWATCHES.map((s) => s.base)).size).toBe(12);
  });

  it("keeps every ink at AA (4.5:1) on both tints of its scheme", () => {
    for (const swatch of COURSE_SWATCHES) {
      for (const scheme of ["light", "dark"] as const) {
        const alpha = SESSION_TINT_ALPHA[scheme];
        const onCard = mixOver(swatch.base, SURFACES[scheme].card, alpha);
        const onBackground = mixOver(
          swatch.base,
          SURFACES[scheme].background,
          alpha,
        );
        expect(contrastRatio(swatch.ink[scheme], onCard)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(swatch.ink[scheme], onBackground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("courseSwatchIndex", () => {
  it("is the key's hash slot when there is no pick", () => {
    expect(courseSwatchIndex(KEY, new Map())).toBe(courseKeyHash(KEY) % 12);
  });

  it("is the same on every call for the same key", () => {
    expect(courseSwatchIndex(KEY, new Map())).toBe(
      courseSwatchIndex(KEY, new Map()),
    );
  });

  it("stays in 0 to 11 for any key", () => {
    for (let i = 0; i < 200; i++) {
      const index = courseSwatchIndex(`portal:S${i}`, new Map());
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(12);
    }
  });

  it("prefers the user's pick", () => {
    expect(courseSwatchIndex(KEY, new Map([[KEY, 11]]))).toBe(11);
  });
});

describe("courseStyleFor", () => {
  it("is null for a session without a course", () => {
    expect(courseStyleFor(null, new Map(), "light")).toBeNull();
  });

  it("paints the swatch at the scheme's tint alpha", () => {
    const overrides = new Map([[KEY, 2]]);
    const light = courseStyleFor(KEY, overrides, "light");
    const dark = courseStyleFor(KEY, overrides, "dark");
    const swatch = COURSE_SWATCHES[2];
    expect(light).toEqual({
      tint: "rgba(214, 51, 108, 0.12)",
      stripe: swatch.base,
      ink: swatch.ink.light,
    });
    expect(dark?.tint).toBe("rgba(214, 51, 108, 0.22)");
    expect(dark?.ink).toBe(swatch.ink.dark);
  });
});

describe("overridesOf", () => {
  it("maps picks by course key", () => {
    const colours: CourseColour[] = [
      { courseKey: "lms:1", swatch: 4 },
      { courseKey: "portal:X", swatch: 9 },
    ];
    expect(overridesOf(colours)).toEqual(
      new Map([
        ["lms:1", 4],
        ["portal:X", 9],
      ]),
    );
  });
});
