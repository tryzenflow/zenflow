import { TIME_GRANULARITY } from "../../common/constants";

/**
 * 15-minute grid snapping for ingested items.
 *
 * Invariant #3 — every `Session.durationMinutes` is a **positive multiple of
 * 15** and every `scheduledStartTime` sits on a 15-minute boundary — is not
 * something DLU respects. Real upstream times are routinely off-grid:
 *
 *  - a 4-period lecture (periods 1–4) runs 07:30–11:10, i.e. **220 minutes**;
 *  - the evening block (periods 11–14) *starts* at **16:40**;
 *  - a Moodle assignment is due at 07:39 or 23:59.
 *
 * So every parser funnels its raw span through {@link snapToGrid}, which
 * widens outward — start **down**, end **up** — never inward. Widening is the
 * safe direction: the block still covers the whole real commitment, so the
 * scheduler never places a task inside time the student is actually busy.
 *
 * Pure: plain integer arithmetic, no clock, no I/O.
 */

/** Grid step in minutes (15). Re-exported so callers need one import. */
export const GRID_MINUTES = TIME_GRANULARITY;

const MS_PER_MINUTE = 60_000;

/** Largest multiple of 15 that is `<= minutes`. */
export function floorToGrid(minutes: number): number {
  return Math.floor(minutes / GRID_MINUTES) * GRID_MINUTES;
}

/** Smallest multiple of 15 that is `>= minutes`. */
export function ceilToGrid(minutes: number): number {
  return Math.ceil(minutes / GRID_MINUTES) * GRID_MINUTES;
}

/** A snapped half-open span `[startMin, endMin)`, both on the grid. */
export interface GridBlock {
  startMin: number;
  endMin: number;
  /** `endMin - startMin`; always a positive multiple of 15. */
  durationMinutes: number;
}

/**
 * Snap a raw `[startMin, endMin)` span outward onto the 15-minute grid.
 *
 * Both bounds are minute counts on the same axis — minutes-from-midnight for
 * portal wall-clock times, epoch minutes for LMS instants; the function is
 * agnostic. A degenerate or inverted span collapses to a single 15-minute
 * slot at the snapped start, so the result is never zero-width (which would
 * violate invariant #3 and produce an unplaceable session).
 *
 * Worked examples from the real payloads:
 *  - periods 1–4, `07:30–11:10` (450→670) ⇒ `450–675`, **225 min**;
 *  - periods 11–14, `16:40–20:00` (1000→1200) ⇒ `990–1200`, **210 min**.
 */
export function snapToGrid(startMin: number, endMin: number): GridBlock {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
    throw new Error(
      `snapToGrid expects finite minute bounds, got (${startMin}, ${endMin})`,
    );
  }
  const start = floorToGrid(startMin);
  const end = Math.max(ceilToGrid(endMin), start + GRID_MINUTES);
  return { startMin: start, endMin: end, durationMinutes: end - start };
}

/**
 * {@link snapToGrid} over absolute instants, for the LMS parser (Moodle hands
 * us epoch seconds, not wall-clock minutes).
 *
 * Snapping in *epoch* minutes lands on the same boundaries as snapping in
 * local wall-clock minutes because every IANA zone in use offsets UTC by a
 * whole number of quarter-hours — Vietnam's `Asia/Ho_Chi_Minh` is a flat
 * UTC+07:00 with no DST — so a UTC quarter-hour is a local quarter-hour.
 * That keeps the LMS path free of any timezone reasoning at all.
 */
export function snapInstantsToGrid(
  start: Date,
  end: Date,
): { scheduledStartTime: Date; durationMinutes: number } {
  const block = snapToGrid(
    Math.floor(start.getTime() / MS_PER_MINUTE),
    Math.ceil(end.getTime() / MS_PER_MINUTE),
  );
  return {
    scheduledStartTime: new Date(block.startMin * MS_PER_MINUTE),
    durationMinutes: block.durationMinutes,
  };
}
