/**
 * Pure settle-decision logic for the custom Week pager
 * (`components/calendar/week-pager.tsx`). Kept framework-agnostic (no
 * React/RN imports) so it's unit-testable with a plain Node/Vitest run — see
 * `lib/__tests__/week-pager-math.test.ts`.
 *
 * The FlatList pager it replaced needed a `dragStartIndexRef` settle cap
 * because Android ignores `disableIntervalMomentum` and a hard flick could
 * die pages away from where the finger let go. The Reanimated pager animates
 * exactly one page per gesture, so the whole decision is: which way (if any)
 * did the gesture want to go — a fast flick always wins (even against the
 * drag position: the finger reversed direction), otherwise the drag
 * position past half a page decides, otherwise snap back.
 */

import { addDays } from "date-fns";
import { weekStart } from "./week-date-math";

// ── Pager-page position constants (shared with PagerPage animatedStyle) ──────

/** The outgoing page moves at this fraction of the finger's speed while the
 * finger is dragging (mockup's swipe frame: at 28% finger drag the outgoing
 * day sits at −9%, i.e. ≈ 0.32× parallax). It eases back up to 1× during the
 * settle so every page lands exactly on its slot at rest. */
export const PARALLAX_FACTOR = 0.32;

/** Opacity the outgoing page fades to mid-swipe (mockup's `opacity-50`). */
export const OUTGOING_DIM_OPACITY = 0.5;

/** Px of strip movement before the incoming page's stack chrome (seam +
 * shadow) fades in, so a resting neighbor never leaks a line at the screen
 * edge. */
export const CHROME_IN_PX = 2;

/** Width (px) of the seam shadow strip cast by the incoming page over the
 * outgoing one — the app's stand-in for the mockup's
 * `shadow-[-16px_0_36px_-12px_rgba(0,0,0,0.32)]` (RN Web supports no `spread`,
 * so a native box-shadow can't reproduce that hard-edged band; an explicit
 * gradient strip can, on web and native alike). */
export const SHADOW_STRIP_PX = 20;

/** Peak opacity of the seam shadow strip — the mockup's `rgba(0,0,0,0.32)`
 * alpha at the darkest pixel (element opacity on top of an opaque-black
 * gradient). */
export const SHADOW_STRIP_PEAK_OPACITY = 0.32;

/** Strip movement over which the seam shadow fades from its floor to peak
 * (matches the legacy overlay's `[CHROME_IN_PX, 60]` ramp). */
export const SHADOW_STRIP_FADE_PX = 60;

/** Drag must exceed this fraction of a page width to settle onto the next
 * page (when the release is slow). */
export const SETTLE_DRAG_RATIO = 0.5;

/** A release faster than this (px per ms — 800 px/s) is a flick and decides
 * the direction regardless of how far the finger actually dragged. Kept above
 * a lazy web release: a short drag that ends with a jittery opposite-sign
 * velocity must not flip direction — only a decisive flick (or a drag past
 * half a page) moves the pager. */
export const SETTLE_VELOCITY = 0.8;

/** Duration (ms) of the settle snap (and snap-back) after a swipe ends —
 * shared by the pager's `withTiming` settles and the Week header's week-slide
 * so the two land on the same frame. Paired with `Easing.out(Easing.cubic)` at
 * every call site (Easing itself can't live here — this module stays
 * RN/reanimated-free so it's plain-Node testable). */
export const SETTLE_MS = 200;

export interface SettleInput {
  /** Finger translation at release, px. Negative = finger moved left (the
   * strip moved left → next day slides in). */
  dragPx: number;
  /** Finger velocity at release, px per ms. Negative = moving left. */
  velocityX: number;
  /** Index of the page the gesture started on. */
  startIndex: number;
  /** Number of pages in the current window. */
  dayCount: number;
  /** Page width, px. */
  width: number;
}

/**
 * The page the pager should settle on after a swipe: `startIndex + 1`,
 * `startIndex - 1`, or `startIndex` itself. An out-of-range result (`-1` or
 * `dayCount`) means the swipe went past the window edge. The pager's live
 * window is a centered 3-day strip (`focusedIndex` is always its middle), so
 * the settle can never escape it — week jumps are gated separately by
 * `shouldSlideWeek`, and the out-of-range contract survives only as a
 * defensive property of the pure function.
 *
 * Sign convention mirrors the pager's `progress` shared value: a leftward
 * flick (negative `dragPx`/`velocityX`) advances to the next day.
 *
 * Order of precedence: the release velocity decides whenever it exceeds the
 * flick threshold (a reversal mid-drag is a deliberate change of intent and
 * overrides how far the finger had gotten), then the drag position past half
 * a page, then stay put.
 */
export function decideSettleTarget({
  dragPx,
  velocityX,
  startIndex,
  dayCount,
  width,
}: SettleInput): number {
  let dir: number;
  if (velocityX <= -SETTLE_VELOCITY) {
    dir = 1;
  } else if (velocityX >= SETTLE_VELOCITY) {
    dir = -1;
  } else if (dragPx <= -SETTLE_DRAG_RATIO * width) {
    dir = 1;
  } else if (dragPx >= SETTLE_DRAG_RATIO * width) {
    dir = -1;
  } else {
    dir = 0;
  }
  return startIndex + dir;
}

/**
 * Whether a settle from a day at `dayIndexInWeek` in direction `dir` should
 * slide the focused day a full week (±7 days) instead of advancing one day.
 * Preserves the legacy 7-day window's edge escape, translated off the window
 * and gated on a decisive flick: only the week's first/last day escapes, only
 * outward (Monday swiped backward, Sunday swiped forward), and only when the
 * release is a real fling (`flicked`) — a slow deliberate drag still settles
 * on the neighbor day. Everything else advances one day. (A centered 3-day
 * window always contains the settle target, so the index-based escape it
 * replaced can never fire.)
 */
export function shouldSlideWeek(
  dayIndexInWeek: number,
  dir: -1 | 0 | 1,
  flicked: boolean,
): boolean {
  if (dir === 0 || !flicked) return false;
  return dayIndexInWeek === 0 ? dir === -1 : dayIndexInWeek === 6 && dir === 1;
}

/**
 * Where a week-slide settle should land — the natural "next/previous day"
 * past the week boundary, not the same weekday:
 * - forward past Sunday → Monday of next week (`weekStart(current) + 7d`),
 *   the day right after Sunday;
 * - backward past Monday → Sunday of previous week
 *   (`weekStart(current) - 7d + 6d`), the day right before Monday.
 *
 * Mirrors the one-day settle the pager does on a slow drag across the same
 * edge — a flick just skips the intermediate days and lands where the slow
 * drag would have ended up after fully crossing the boundary.
 */
export function computeWeekSlideTarget(current: Date, dir: 1 | -1): Date {
  const adjacentWeekStart = addDays(weekStart(current), dir * 7);
  return dir === 1 ? adjacentWeekStart : addDays(adjacentWeekStart, 6);
}

// ── PagerPage position computation ───────────────────────────────────────────

/** Clamped linear interpolation (Reanimated's `interpolate` with CLAMP). */
function lerpClamp(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  "worklet";
  const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

export interface PagePositionInput {
  /** Page index in the mounted array. */
  index: number;
  /** Single-page width, px. */
  width: number;
  /** `progress.value` — strip offset from rest (rest = `-focusedIndex * w`). */
  progress: number;
  /** `fromSV.value` — index of the outgoing (parallaxing) page. */
  outIndex: number;
  /** `toSV.value` — index of the incoming (stacking) page. */
  toIndex: number;
  /** `draggingSV.value` — 1 while the finger is down, 0 during settle. */
  dragging: 0 | 1;
  /** Index of the page holding the lifted task block, or −1 if none. */
  carrierIndex: number;
  /** `index * width + progress` at the moment the task was lifted. */
  carrierOrigin: number;
  /** 1 while the WeekHeader owns the strip for its week swipe — the pages then
   * track the finger 1:1 (plain strip translate, no parallax lag), matching the
   * header block's own 1:1 motion. Default 0. */
  headerDrag?: 0 | 1;
}

export interface PagePositionOutput {
  /** Final translateX for the page. */
  translateX: number;
  /** Page opacity (outgoing dims; carrier stays at 1 so the lifted block
   * remains visible; non-active pages are 0). */
  opacity: number;
  /** Z-index (carrier 10, incoming 9, outgoing 8, rest 0). */
  zIndex: number;
  /** True if this page is the outgoing (parallaxing) page. */
  isOutgoing: boolean;
  /** True if this page is the incoming (stacking) page. */
  isIncoming: boolean;
  /** True if this page is the carrier (holding a pinned lifted block). */
  isCarrier: boolean;
  /** Stack-seam side for the incoming page, or null. */
  seam: "left" | "right" | null;
}

/**
 * Pure, testable counterpart of the `PagerPage` `useAnimatedStyle` body in
 * `week-pager.tsx`. Returns the same translateX / opacity / zIndex the
 * worklet computes, driven by plain numbers instead of shared values.
 *
 * **Carrier pin**: when `carrierIndex ≥ 0`, the carrier page is pinned at
 * `carrierOrigin` — the parallax offset is excluded so the strip snap
 * (progress jump) doesn't move the page. This keeps the lifted task block
 * glued to the user's finger.
 */
export function computePagePosition({
  index,
  width,
  progress,
  outIndex,
  toIndex,
  dragging,
  carrierIndex,
  carrierOrigin,
  headerDrag = 0,
}: PagePositionInput): PagePositionOutput {
  "worklet";
  const slot = index * width;
  const m = progress + outIndex * width;
  const absM = Math.abs(m);

  const inIndex = toIndex === outIndex ? outIndex + (m < 0 ? 1 : -1) : toIndex;

  const isOutgoing = index === outIndex;
  const isIncoming = index === inIndex;
  const isCarrier = index === carrierIndex;

  // Header-driven week slide: the WeekHeader chip strip moves 1:1 with the
  // finger, so the day pages under it must too. The parallax path below would
  // creep the focused (outgoing) page at PARALLAX_FACTOR while the header
  // zipped a full page — which read as "only the header moves, the grid stays
  // put". Plain strip translate here; keep just the incoming page's card seam
  // for depth.
  if (headerDrag) {
    const sliding = absM > CHROME_IN_PX;
    const fromRight = index === outIndex + 1;
    return {
      translateX: slot + progress,
      opacity: isOutgoing || isIncoming ? 1 : 0,
      zIndex: isIncoming ? 9 : isOutgoing ? 8 : 0,
      isOutgoing,
      isIncoming,
      isCarrier: false,
      seam: isIncoming && sliding ? (fromRight ? "left" : "right") : null,
    };
  }

  // Parallax factor: held at PARALLAX_FACTOR while the finger drags, then
  // eased to 1× over the settle so the outgoing page lands on its slot.
  const factor = isOutgoing
    ? dragging
      ? PARALLAX_FACTOR
      : lerpClamp(absM, 0, width, PARALLAX_FACTOR, 1)
    : 1;

  // Carrier fix: pin the carrier page at its touch-down screen position so
  // the block inside stays glued to the finger. The fix cancels both the
  // strip's own slot+progress term AND the outgoing parallax (the carrier
  // page is typically the outgoing page during a rightward drag).
  const carrierFix = isCarrier
    ? carrierOrigin - (slot + progress + (isOutgoing ? (factor - 1) * m : 0))
    : 0;

  const translateX =
    slot + progress + carrierFix + (isOutgoing ? (factor - 1) * m : 0);

  const opacity = isCarrier
    ? 1
    : isOutgoing
      ? lerpClamp(absM, 0, width * 0.3, 1, OUTGOING_DIM_OPACITY)
      : isIncoming
        ? 1
        : 0;

  const zIndex = isCarrier ? 10 : isIncoming ? 9 : isOutgoing ? 8 : 0;

  const sliding = absM > CHROME_IN_PX;
  const fromRight = index === outIndex + 1;
  const seam: "left" | "right" | null =
    isIncoming && sliding ? (fromRight ? "left" : "right") : null;

  return {
    translateX,
    opacity,
    zIndex,
    isOutgoing,
    isIncoming,
    isCarrier,
    seam,
  };
}

// ── Incoming-page seam shadow strip ──────────────────────────────────────────

export interface ShadowStripInput {
  /** `progress.value` — strip offset from rest (rest = `-focusedIndex * w`). */
  progress: number;
  /** `fromSV.value` — index of the outgoing (parallaxing) page. */
  outIndex: number;
  /** `toSV.value` — index of the incoming (stacking) page. */
  toIndex: number;
  /** Single-page width, px. */
  width: number;
}

export interface ShadowStripOutput {
  /** The incoming page's leading edge on screen (px from container left). */
  seamX: number;
  /** Opacity for the strip cast left of the seam (next-day swipe). */
  nextDayOpacity: number;
  /** Opacity for the strip cast right of the seam (previous-day swipe). */
  prevDayOpacity: number;
}

/**
 * Pure, testable counterpart of the seam-shadow strip in `week-pager.tsx`.
 * The strip sits at the incoming page's leading edge — on the side of the
 * outgoing page — and fades in as the strip moves (`CHROME_IN_PX`), ramping
 * to `SHADOW_STRIP_PEAK_OPACITY` over `SHADOW_STRIP_FADE_PX`.
 *
 * Sign convention mirrors `computePagePosition`: `m < 0` (finger left) means
 * the next day slides in from the right, so its shadow must fall over the
 * current day (left of the seam); `m > 0` mirrors it for the previous day.
 */
export function computeShadowStrip({
  progress,
  outIndex,
  toIndex,
  width,
}: ShadowStripInput): ShadowStripOutput {
  "worklet";
  const m = progress + outIndex * width;
  const absM = Math.abs(m);
  const inIndex = toIndex === outIndex ? outIndex + (m < 0 ? 1 : -1) : toIndex;

  const sliding = absM > CHROME_IN_PX;
  const opacity = sliding
    ? lerpClamp(
        absM,
        CHROME_IN_PX,
        SHADOW_STRIP_FADE_PX,
        0.08,
        SHADOW_STRIP_PEAK_OPACITY,
      )
    : 0;

  const seamX = inIndex * width + progress;
  const fromRight = inIndex === outIndex + 1;

  return {
    seamX,
    nextDayOpacity: fromRight ? opacity : 0,
    prevDayOpacity: fromRight ? 0 : opacity,
  };
}
