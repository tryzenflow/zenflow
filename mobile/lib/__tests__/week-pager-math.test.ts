import { describe, expect, it } from "vitest";
import {
  SETTLE_DRAG_RATIO,
  SETTLE_VELOCITY,
  decideSettleTarget,
} from "../week-pager-math";

const WIDTH = 390;

function settle(input: Partial<Parameters<typeof decideSettleTarget>[0]>) {
  return decideSettleTarget({
    dragPx: 0,
    velocityX: 0,
    startIndex: 3,
    dayCount: 7,
    width: WIDTH,
    ...input,
  });
}

describe("decideSettleTarget", () => {
  it("stays put when the drag is short and the release is slow", () => {
    expect(settle({ dragPx: -0.3 * WIDTH, velocityX: -0.1 })).toBe(3);
    expect(settle({ dragPx: 0.3 * WIDTH, velocityX: 0.1 })).toBe(3);
  });

  it("advances to the next day past half a page dragged left", () => {
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: -0.1 })).toBe(4);
    expect(settle({ dragPx: -WIDTH, velocityX: 0 })).toBe(4);
  });

  it("goes back to the previous day past half a page dragged right", () => {
    expect(settle({ dragPx: 0.6 * WIDTH, velocityX: 0.1 })).toBe(2);
    expect(settle({ dragPx: WIDTH, velocityX: 0 })).toBe(2);
  });

  it("a fast left flick advances even with a short drag", () => {
    expect(settle({ dragPx: -0.2 * WIDTH, velocityX: -SETTLE_VELOCITY - 0.4 })).toBe(4);
  });

  it("a fast right flick goes back even with a short drag", () => {
    expect(settle({ dragPx: 0.2 * WIDTH, velocityX: SETTLE_VELOCITY + 0.4 })).toBe(2);
  });

  it("a flick against the drag direction wins over the position", () => {
    // Dragged 60% of a page left but flung back right — the fling decides.
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: SETTLE_VELOCITY + 0.5 })).toBe(2);
    expect(settle({ dragPx: 0.6 * WIDTH, velocityX: -SETTLE_VELOCITY - 0.5 })).toBe(4);
  });

  it("release-velocity jitter on a long drag does not flip the direction", () => {
    // Dragged 60% of a page left but the release sampled a weak opposite
    // velocity (common at the end of a lazy web/mouse drag): the position —
    // clearly past half a page — decides, not the jitter.
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: 0.4 })).toBe(4);
    expect(settle({ dragPx: 0.6 * WIDTH, velocityX: -0.4 })).toBe(2);
  });

  it("lets an edge swipe escape the window to signal the week slide", () => {
    // A rightward fling at the leading edge returns -1: there is no previous
    // day in the window, so the pager slides the whole window one week back.
    expect(
      settle({ dragPx: WIDTH, velocityX: SETTLE_VELOCITY + 0.5, startIndex: 0 }),
    ).toBe(-1);
    // A leftward fling at the trailing edge returns dayCount (7): the pager
    // slides the window one week forward.
    expect(
      settle({ dragPx: -WIDTH, velocityX: -SETTLE_VELOCITY - 0.5, startIndex: 6 }),
    ).toBe(7);
    // A slow drag past the edge at the leading edge also escapes.
    expect(settle({ dragPx: WIDTH, velocityX: 0, startIndex: 0 })).toBe(-1);
    // Within the window the target stays clamped to the settle itself.
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: 0, startIndex: 0 })).toBe(1);
  });

  it("handles a one-day window (either edge is the same page)", () => {
    expect(settle({ dragPx: -WIDTH, velocityX: -1, dayCount: 1, startIndex: 0 })).toBe(1);
    expect(settle({ dragPx: WIDTH, velocityX: 1, dayCount: 1, startIndex: 0 })).toBe(-1);
  });

  it("is symmetric around the exact half-page threshold", () => {
    const half = SETTLE_DRAG_RATIO * WIDTH;
    expect(settle({ dragPx: -half - 1, velocityX: -0.01 })).toBe(4);
    expect(settle({ dragPx: half + 1, velocityX: 0.01 })).toBe(2);
  });
});