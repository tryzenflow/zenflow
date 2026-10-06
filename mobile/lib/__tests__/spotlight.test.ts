import { describe, expect, it } from "vitest";
import {
  arrowLeft,
  bubblePlacement,
  isOnScreen,
  spotlightRect,
} from "../spotlight";

const screen = { width: 400, height: 800 };

describe("spotlightRect", () => {
  it("pads the target and clamps to the screen", () => {
    expect(
      spotlightRect({ x: 100, y: 100, width: 50, height: 40 }, screen),
    ).toEqual({ x: 94, y: 94, width: 62, height: 52 });
    expect(
      spotlightRect({ x: 2, y: 2, width: 396, height: 40 }, screen),
    ).toEqual({ x: 0, y: 0, width: 400, height: 48 });
  });
});

describe("bubblePlacement", () => {
  const insets = { top: 50, bottom: 34 };
  it("goes below when there is room", () => {
    const p = bubblePlacement(
      { x: 10, y: 100, width: 50, height: 50 },
      screen,
      insets,
      90,
    );
    expect(p).toEqual({ top: 160, side: "below" });
  });
  it("goes above near the bottom edge", () => {
    const p = bubblePlacement(
      { x: 10, y: 700, width: 50, height: 50 },
      screen,
      insets,
      90,
    );
    expect(p).toEqual({ top: 600, side: "above" });
  });
  it("never rises into the top inset", () => {
    const p = bubblePlacement(
      { x: 10, y: 60, width: 50, height: 700 },
      screen,
      insets,
      90,
    );
    expect(p.top).toBeGreaterThanOrEqual(58);
  });
});

describe("arrowLeft", () => {
  it("centres on the spotlight, clamped inside the bubble", () => {
    expect(arrowLeft({ x: 150, y: 0, width: 100, height: 10 }, 20, 360)).toBe(
      173,
    );
    expect(arrowLeft({ x: 0, y: 0, width: 10, height: 10 }, 20, 360)).toBe(12);
    expect(arrowLeft({ x: 395, y: 0, width: 10, height: 10 }, 20, 360)).toBe(
      334,
    );
  });
});

describe("isOnScreen", () => {
  it("needs the whole rect inside the window", () => {
    expect(isOnScreen({ x: 10, y: 10, width: 50, height: 50 }, screen)).toBe(true);
    expect(isOnScreen({ x: 10, y: 780, width: 50, height: 50 }, screen)).toBe(false);
    expect(isOnScreen({ x: 10, y: -30, width: 50, height: 50 }, screen)).toBe(false);
    expect(isOnScreen({ x: 380, y: 10, width: 50, height: 50 }, screen)).toBe(false);
  });
});
