import { describe, expect, it } from "vitest";
import {
  clockLabel,
  fractionOf,
  snapToStep,
  valueAtX,
} from "../slider-math";

describe("snapToStep", () => {
  it("snaps to the nearest step from min", () => {
    expect(snapToStep(22, 15, 480, 15)).toBe(15);
    expect(snapToStep(23, 15, 480, 15)).toBe(30);
  });

  it("clamps to the range", () => {
    expect(snapToStep(-10, 15, 480, 15)).toBe(15);
    expect(snapToStep(9999, 15, 480, 15)).toBe(480);
  });

  it("never overshoots max when the range is not a whole number of steps", () => {
    expect(snapToStep(470, 15, 400, 15)).toBe(400);
  });
});

describe("valueAtX", () => {
  it("maps a position to a snapped value", () => {
    expect(valueAtX(0, 300, 15, 300, 15)).toBe(15);
    expect(valueAtX(150, 300, 0, 300, 15)).toBe(150);
    expect(valueAtX(300, 300, 0, 300, 15)).toBe(300);
  });

  it("returns min for a track that has not been measured", () => {
    expect(valueAtX(50, 0, 15, 300, 15)).toBe(15);
  });
});

describe("fractionOf", () => {
  it("returns a clamped 0 to 1 fraction", () => {
    expect(fractionOf(15, 15, 135)).toBe(0);
    expect(fractionOf(75, 15, 135)).toBe(0.5);
    expect(fractionOf(999, 15, 135)).toBe(1);
  });
});

describe("clockLabel", () => {
  it("formats minutes of day as HH:mm", () => {
    expect(clockLabel(9 * 60 + 15)).toBe("09:15");
    expect(clockLabel(23 * 60 + 45)).toBe("23:45");
  });
});
