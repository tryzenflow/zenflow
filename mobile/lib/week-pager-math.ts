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

/** Drag must exceed this fraction of a page width to settle onto the next
 * page (when the release is slow). */
export const SETTLE_DRAG_RATIO = 0.5;

/** A release faster than this (px per ms — 800 px/s) is a flick and decides
 * the direction regardless of how far the finger actually dragged. Kept above
 * a lazy web release: a short drag that ends with a jittery opposite-sign
 * velocity must not flip direction — only a decisive flick (or a drag past
 * half a page) moves the pager. */
export const SETTLE_VELOCITY = 0.8;

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
 * `dayCount`) means the swipe went past the window edge — the pager responds
 * by sliding the whole window ±1 week (the settle itself stays clamped).
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