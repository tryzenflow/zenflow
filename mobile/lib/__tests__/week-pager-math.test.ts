import { describe, expect, it } from "vitest";
import {
  SETTLE_DRAG_RATIO,
  SETTLE_VELOCITY,
  PARALLAX_FACTOR,
  CHROME_IN_PX,
  SHADOW_STRIP_PEAK_OPACITY,
  SHADOW_STRIP_FADE_PX,
  decideSettleTarget,
  computePagePosition,
  computeShadowStrip,
  shouldSlideWeek,
  type PagePositionInput,
  type ShadowStripInput,
} from "../week-pager-math";

const WIDTH = 390;

// The pager's live window is a centered 3-day strip: the focused page is
// always the middle index (1).
function settle(input: Partial<Parameters<typeof decideSettleTarget>[0]>) {
  return decideSettleTarget({
    dragPx: 0,
    velocityX: 0,
    startIndex: 1,
    dayCount: 3,
    width: WIDTH,
    ...input,
  });
}

describe("decideSettleTarget", () => {
  it("stays put when the drag is short and the release is slow", () => {
    expect(settle({ dragPx: -0.3 * WIDTH, velocityX: -0.1 })).toBe(1);
    expect(settle({ dragPx: 0.3 * WIDTH, velocityX: 0.1 })).toBe(1);
  });

  it("advances to the next day past half a page dragged left", () => {
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: -0.1 })).toBe(2);
    expect(settle({ dragPx: -WIDTH, velocityX: 0 })).toBe(2);
  });

  it("goes back to the previous day past half a page dragged right", () => {
    expect(settle({ dragPx: 0.6 * WIDTH, velocityX: 0.1 })).toBe(0);
    expect(settle({ dragPx: WIDTH, velocityX: 0 })).toBe(0);
  });

  it("a fast left flick advances even with a short drag", () => {
    expect(settle({ dragPx: -0.2 * WIDTH, velocityX: -SETTLE_VELOCITY - 0.4 })).toBe(2);
  });

  it("a fast right flick goes back even with a short drag", () => {
    expect(settle({ dragPx: 0.2 * WIDTH, velocityX: SETTLE_VELOCITY + 0.4 })).toBe(0);
  });

  it("a flick against the drag direction wins over the position", () => {
    // Dragged 60% of a page left but flung back right — the fling decides.
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: SETTLE_VELOCITY + 0.5 })).toBe(0);
    expect(settle({ dragPx: 0.6 * WIDTH, velocityX: -SETTLE_VELOCITY - 0.5 })).toBe(2);
  });

  it("release-velocity jitter on a long drag does not flip the direction", () => {
    // Dragged 60% of a page left but the release sampled a weak opposite
    // velocity (common at the end of a lazy web/mouse drag): the position —
    // clearly past half a page — decides, not the jitter.
    expect(settle({ dragPx: -0.6 * WIDTH, velocityX: 0.4 })).toBe(2);
    expect(settle({ dragPx: 0.6 * WIDTH, velocityX: -0.4 })).toBe(0);
  });

  it("never escapes the centered 3-window — week jumps are gated separately", () => {
    // The focused page is always the middle index (1), so a settle can only
    // land on 0, 1, or 2; week jumps are decided by `shouldSlideWeek`.
    expect(settle({ dragPx: WIDTH, velocityX: SETTLE_VELOCITY + 0.5 })).toBe(0);
    expect(settle({ dragPx: -WIDTH, velocityX: -SETTLE_VELOCITY - 0.5 })).toBe(2);
    // Even a hard flick from the middle stays one page away.
    expect(settle({ dragPx: -2 * WIDTH, velocityX: -3 })).toBe(2);
    expect(settle({ dragPx: 2 * WIDTH, velocityX: 3 })).toBe(0);
  });

  it("handles a one-day window (either edge is the same page)", () => {
    expect(settle({ dragPx: -WIDTH, velocityX: -1, dayCount: 1, startIndex: 0 })).toBe(1);
    expect(settle({ dragPx: WIDTH, velocityX: 1, dayCount: 1, startIndex: 0 })).toBe(-1);
  });

  it("is symmetric around the exact half-page threshold", () => {
    const half = SETTLE_DRAG_RATIO * WIDTH;
    expect(settle({ dragPx: -half - 1, velocityX: -0.01 })).toBe(2);
    expect(settle({ dragPx: half + 1, velocityX: 0.01 })).toBe(0);
  });
});

describe("shouldSlideWeek", () => {
  it("Monday swiped backward with a decisive flick slides the week", () => {
    expect(shouldSlideWeek(0, -1, true)).toBe(true);
  });

  it("Sunday swiped forward with a decisive flick slides the week", () => {
    expect(shouldSlideWeek(6, 1, true)).toBe(true);
  });

  it("a slow deliberate drag from a week edge advances one day instead", () => {
    expect(shouldSlideWeek(0, -1, false)).toBe(false);
    expect(shouldSlideWeek(6, 1, false)).toBe(false);
  });

  it("a week's interior never slides, regardless of direction", () => {
    for (const dayIndex of [1, 2, 3, 4, 5]) {
      expect(shouldSlideWeek(dayIndex, -1, true)).toBe(false);
      expect(shouldSlideWeek(dayIndex, 1, true)).toBe(false);
    }
  });

  it("Monday swiped forward and Sunday swiped backward advance one day", () => {
    expect(shouldSlideWeek(0, 1, true)).toBe(false);
    expect(shouldSlideWeek(6, -1, true)).toBe(false);
  });

  it("no direction never slides", () => {
    expect(shouldSlideWeek(0, 0, true)).toBe(false);
    expect(shouldSlideWeek(6, 0, false)).toBe(false);
  });
});

// ── computePagePosition ──────────────────────────────────────────────────────

function pos(input: Partial<PagePositionInput> & { index: number }) {
  return computePagePosition({
    width: WIDTH,
    progress: 0,
    outIndex: 0,
    toIndex: 0,
    dragging: 0,
    carrierIndex: -1,
    carrierOrigin: 0,
    ...input,
  });
}

describe("computePagePosition", () => {
  it("places a non-carrier page at rest in its own slot", () => {
    // index=2, progress=0, no outgoing/incoming → translateX = 2*390 = 780
    const p = pos({ index: 2 });
    expect(p.translateX).toBe(2 * WIDTH);
    expect(p.opacity).toBe(0);
    expect(p.zIndex).toBe(0);
  });

  it("outgoing page with drag gets parallax offset and dims", () => {
    // outIndex=2, dragging right by 100px → m = progress + outIndex*width = 100 + 780 = 880
    // factor=PARALLAX_FACTOR, parallax = (0.32-1)*880 = -585.6
    const p = pos({ index: 2, outIndex: 2, toIndex: 2, progress: 100, dragging: 1 });
    expect(p.isOutgoing).toBe(true);
    expect(p.translateX).toBeCloseTo(2 * WIDTH + 100 + (PARALLAX_FACTOR - 1) * (100 + 2 * WIDTH));
    expect(p.opacity).toBeLessThan(1);
    expect(p.opacity).toBeGreaterThan(0);
  });

  it("incoming page during drag sits at slot+progress with high zIndex", () => {
    // Leftward drag: progress=-100, outIndex=3, toIndex=2, index=2
    const p = pos({ index: 2, outIndex: 3, toIndex: 2, progress: -100 });
    expect(p.isIncoming).toBe(true);
    expect(p.translateX).toBeCloseTo(2 * WIDTH - 100);
    expect(p.zIndex).toBe(9);
    expect(p.opacity).toBe(1);
  });

  it("carrier page at rest (no drag) stays at carrierOrigin", () => {
    const p = pos({
      index: 2,
      progress: -2 * WIDTH, // at rest for index 2
      carrierIndex: 2,
      carrierOrigin: 0,
    });
    expect(p.translateX).toBe(0);
  });

  it("carrier IS outgoing during drag — stays at carrierOrigin, parallax excluded", () => {
    // This is THE BUG CASE: rightward drag, carrier=outgoing page.
    // carrierOrigin captured at touch-down (progress starts at -outIndex*width,
    // so carrierOrigin = index*w + progress = 0).
    // After dragging 100px: progress = -2*390 + 100
    const dx = 100;
    const p = pos({
      index: 2,
      outIndex: 2,
      toIndex: 2,
      progress: -2 * WIDTH + dx,
      dragging: 1,
      carrierIndex: 2,
      carrierOrigin: 0,
    });
    // Without the fix: translateX = 0 + (PARALLAX_FACTOR-1)*dx ≈ -68 (drifts!)
    // With the fix: translateX = 0 (pinned)
    expect(p.translateX).toBe(0);
    expect(p.isOutgoing).toBe(true);
  });

  it("carrier after advance (no longer outgoing) stays at carrierOrigin", () => {
    // Rightward advance fired: progress jumped to -3*390, outIndex=3.
    // Carrier page (index=2) is no longer outgoing. carrierOrigin still 0.
    const p = pos({
      index: 2,
      outIndex: 3,
      toIndex: 3,
      progress: -3 * WIDTH,
      carrierIndex: 2,
      carrierOrigin: 0,
    });
    expect(p.translateX).toBe(0);
    expect(p.isOutgoing).toBe(false);
  });

  it("non-carrier pages are unaffected by the carrier", () => {
    // Carrier is index=2, we check index=3 (an incoming page)
    const p = pos({
      index: 3,
      outIndex: 2,
      toIndex: 3,
      progress: -100,
      carrierIndex: 2,
      carrierOrigin: 0,
    });
    expect(p.translateX).toBeCloseTo(3 * WIDTH - 100);
    expect(p.isIncoming).toBe(true);
  });

  it("carrierIndex=-1 (no carrier) means no carrier fix for any page", () => {
    // m = progress + outIndex*width = 100 + 780 = 880
    const p = pos({
      index: 2,
      outIndex: 2,
      toIndex: 2,
      progress: 100,
      dragging: 1,
      carrierIndex: -1,
    });
    // Normal outgoing behavior — parallax applied
    expect(p.translateX).toBeCloseTo(2 * WIDTH + 100 + (PARALLAX_FACTOR - 1) * (100 + 2 * WIDTH));
  });
});

// ── computeShadowStrip ───────────────────────────────────────────────────────

function strip(input: Partial<ShadowStripInput>) {
  return computeShadowStrip({
    progress: 0,
    outIndex: 3,
    toIndex: 3,
    width: WIDTH,
    ...input,
  });
}

describe("computeShadowStrip", () => {
  it("no shadow at rest", () => {
    // At rest progress = -outIndex*width, so m = 0
    const s = strip({ progress: -3 * WIDTH });
    expect(s.nextDayOpacity).toBe(0);
    expect(s.prevDayOpacity).toBe(0);
  });

  it("no shadow within the CHROME_IN_PX deadzone", () => {
    const s = strip({ progress: -3 * WIDTH + CHROME_IN_PX });
    expect(s.nextDayOpacity).toBe(0);
  });

  it("next-day swipe casts the shadow left of the incoming seam", () => {
    // Finger left → m = -100, incoming page 4 slides in from the right
    const s = strip({ progress: -3 * WIDTH - 100 });
    expect(s.nextDayOpacity).toBeGreaterThan(0);
    expect(s.prevDayOpacity).toBe(0);
    // Incoming page's leading edge sits at 4*width + progress = 1460
    expect(s.seamX).toBe(4 * WIDTH - 3 * WIDTH - 100);
  });

  it("previous-day swipe casts the shadow right of the incoming seam", () => {
    const s = strip({ progress: -3 * WIDTH + 100 });
    expect(s.prevDayOpacity).toBeGreaterThan(0);
    expect(s.nextDayOpacity).toBe(0);
    expect(s.seamX).toBe(2 * WIDTH - 3 * WIDTH + 100);
  });

  it("ramps opacity from the floor to the mockup peak over the fade window", () => {
    const mid = strip({
      progress: -3 * WIDTH - (CHROME_IN_PX + SHADOW_STRIP_FADE_PX) / 2,
    });
    // Linear halfway between 0.08 and 0.32
    expect(mid.nextDayOpacity).toBeCloseTo(0.2, 5);

    const deep = strip({ progress: -3 * WIDTH - SHADOW_STRIP_FADE_PX * 2 });
    expect(deep.nextDayOpacity).toBeCloseTo(SHADOW_STRIP_PEAK_OPACITY, 5);
  });

  it("during a settle the seam follows the target page", () => {
    // toIndex = 4 is fixed mid-settle; seamX tracks page 4's leading edge
    const s = strip({ progress: -4 * WIDTH, toIndex: 4 });
    expect(s.nextDayOpacity).toBeCloseTo(SHADOW_STRIP_PEAK_OPACITY, 5);
    expect(s.seamX).toBe(4 * WIDTH - 4 * WIDTH);
  });
});