import { describe, expect, it } from "vitest";
import {
  HOUR_HEIGHT_DEFAULT,
  HOUR_HEIGHT_MAX,
  HOUR_HEIGHT_MIN,
  blockTier,
  buildDayGrid,
  clampHourHeight,
  dragTargetMin,
  gridHeightFor,
  minToY,
  scrollAnchorMin,
  scrollYForMin,
  visibleHourMinutes,
  yToMin,
} from "../day-grid";

describe("hour height", () => {
  it("defaults to 56 and clamps the pinch range to 36..160", () => {
    expect(HOUR_HEIGHT_DEFAULT).toBe(56);
    expect(clampHourHeight(20)).toBe(HOUR_HEIGHT_MIN);
    expect(clampHourHeight(56)).toBe(56);
    expect(clampHourHeight(400)).toBe(HOUR_HEIGHT_MAX);
  });
});

describe("buildDayGrid", () => {
  it("is 24 hours of one band, no folded hours", () => {
    const grid = buildDayGrid(56);
    expect(grid.height).toBe(24 * 56);
    expect(grid.bands).toHaveLength(1);
  });

  it("matches gridHeightFor", () => {
    for (const hourHeight of [36, 56, 120, 160]) {
      expect(gridHeightFor(hourHeight)).toBe(buildDayGrid(hourHeight).height);
    }
  });
});

describe("minToY / yToMin", () => {
  it("maps the unfolded day linearly", () => {
    const grid = buildDayGrid(56);
    expect(minToY(grid, 0)).toBe(0);
    expect(minToY(grid, 60)).toBe(56);
    expect(minToY(grid, 90)).toBe(84);
  });

  it("places 08:00 at 8 hours and 24:00 at the bottom", () => {
    const grid = buildDayGrid(56);
    expect(minToY(grid, 8 * 60)).toBe(8 * 56);
    expect(minToY(grid, 24 * 60)).toBe(grid.height);
  });

  it("round-trips every quarter hour", () => {
    const grid = buildDayGrid(56);
    for (let m = 0; m <= 24 * 60; m += 15) {
      expect(yToMin(grid, minToY(grid, m))).toBeCloseTo(m, 6);
    }
  });

  it("clamps out-of-range inputs", () => {
    const grid = buildDayGrid(56);
    expect(minToY(grid, -10)).toBe(0);
    expect(minToY(grid, 99999)).toBe(grid.height);
    expect(yToMin(grid, -5)).toBe(0);
    expect(yToMin(grid, grid.height + 50)).toBe(24 * 60);
  });
});

describe("dragTargetMin", () => {
  it("moves by the px distance on the unfolded day", () => {
    const grid = buildDayGrid(56);
    // 56px is one hour.
    expect(dragTargetMin(grid, 10 * 60, 56)).toBeCloseTo(11 * 60, 6);
    expect(dragTargetMin(grid, 10 * 60, -28)).toBeCloseTo(9 * 60 + 30, 6);
  });

  it("is the same mapping the block uses for its own top", () => {
    const grid = buildDayGrid(56);
    for (const start of [8 * 60, 9 * 60 + 15, 14 * 60, 22 * 60 + 45]) {
      expect(dragTargetMin(grid, start, 0)).toBeCloseTo(start, 6);
      const dy = minToY(grid, start + 60) - minToY(grid, start);
      expect(dragTargetMin(grid, start, dy)).toBeCloseTo(start + 60, 6);
    }
  });
});

describe("visibleHourMinutes", () => {
  it("lists all 24 hours", () => {
    expect(visibleHourMinutes(buildDayGrid(56))).toHaveLength(24);
  });
});

describe("blockTier", () => {
  it("shows the title only under 24px", () => {
    expect(blockTier(16)).toBe("title");
    expect(blockTier(23.9)).toBe("title");
  });

  it("adds the start time under 44px", () => {
    expect(blockTier(24)).toBe("time");
    expect(blockTier(43.9)).toBe("time");
  });

  it("adds location from 44px", () => {
    expect(blockTier(44)).toBe("full");
    expect(blockTier(120)).toBe("full");
  });
});

describe("scroll anchor", () => {
  it("opens on now for today", () => {
    expect(
      scrollAnchorMin({ isToday: true, nowMin: 13 * 60, firstEventMin: 9 * 60 }),
    ).toBe(13 * 60);
  });

  it("opens on the first event for another day", () => {
    expect(
      scrollAnchorMin({ isToday: false, nowMin: 13 * 60, firstEventMin: 9 * 60 }),
    ).toBe(9 * 60);
  });

  it("falls back to 08:00 for an empty other day", () => {
    expect(
      scrollAnchorMin({ isToday: false, nowMin: 13 * 60, firstEventMin: null }),
    ).toBe(8 * 60);
  });

  it("scrolls the anchor to 120px below the top, never negative", () => {
    const grid = buildDayGrid(56);
    expect(scrollYForMin(grid, 10 * 60)).toBe(minToY(grid, 600) - 120);
    expect(scrollYForMin(grid, 0)).toBe(0);
  });
});

describe("fit", () => {
  it("fits 08:00 to 22:00 in about 1.5 phone screens of ~700pt", () => {
    const grid = buildDayGrid(HOUR_HEIGHT_DEFAULT);
    const span = minToY(grid, 22 * 60) - minToY(grid, 8 * 60);
    expect(span).toBe(14 * HOUR_HEIGHT_DEFAULT);
    expect(span / 700).toBeLessThan(1.5);
  });
});
