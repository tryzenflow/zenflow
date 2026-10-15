import { describe, expect, it } from "vitest";
import { sittingMinutes } from "../split-sittings";

describe("sittingMinutes", () => {
  it("splits evenly on the 15-minute grid", () => {
    expect(sittingMinutes(180, 2)).toEqual([90, 90]);
  });

  it("keeps the total exact, giving the extra slots to the first sittings", () => {
    const parts = sittingMinutes(120, 3);
    expect(parts).toEqual([45, 45, 30]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(120);
  });

  it("returns a single sitting for a count of one", () => {
    expect(sittingMinutes(60, 1)).toEqual([60]);
  });

  it("caps the count at one sitting per slot", () => {
    expect(sittingMinutes(30, 5)).toEqual([15, 15]);
  });

  it("never returns an empty list", () => {
    expect(sittingMinutes(15, 0)).toEqual([15]);
  });
});
