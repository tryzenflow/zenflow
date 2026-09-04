import type { SchedulingArm } from "@zenflow/shared";
import { utcToMinutes } from "../../common/utils";

/**
 * The five Disjoint-LinUCB time-of-day bands
 * (`docs/adr/0001-linucb-model-design.md` §2). Ranges are minute-of-day in the
 * user's LOCAL wall clock, **half-open, lower-inclusive** — a slot starting
 * exactly at 17:00 (minute 1020) is `EVENING`.
 *
 * Pure: no I/O, no clock, no randomness.
 */
export interface ArmBand {
  arm: SchedulingArm;
  /** Minute of day, inclusive. */
  start: number;
  /** Minute of day, exclusive. */
  end: number;
}

export const ARM_BANDS: readonly ArmBand[] = [
  { arm: "EARLY_MORNING", start: 0, end: 360 },
  { arm: "MORNING", start: 360, end: 660 },
  { arm: "AFTERNOON", start: 660, end: 1020 },
  { arm: "EVENING", start: 1020, end: 1200 },
  { arm: "NIGHT", start: 1200, end: 1440 },
];

/** The arm whose half-open band contains `minuteOfDay` (wrapped into `[0, 1440)`). */
export function armOfMinute(minuteOfDay: number): SchedulingArm {
  const m = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  for (const band of ARM_BANDS) {
    if (m >= band.start && m < band.end) return band.arm;
  }
  // Unreachable — the bands tile [0, 1440) with no gap.
  return "NIGHT";
}

const MS_PER_MIN = 60_000;
const MINUTES_PER_DAY = 1440;

/**
 * Fraction of `[startMs, endMs)` whose local wall-clock minute-of-day falls
 * inside `arm`'s band, in `timezone`.
 *
 * A slot may span local midnight (D5): it is split at each local-midnight
 * boundary and the same-day overlap of every segment with the band is summed.
 * The band identifiers repeat each day, so e.g. a 23:00–01:00 slot contributes
 * to `NIGHT` (23:00–24:00) and `EARLY_MORNING` (00:00–01:00).
 */
export function overlapRate(
  startMs: number,
  endMs: number,
  arm: SchedulingArm,
  timezone: string,
): number {
  if (endMs <= startMs) return 0;

  const band = ARM_BANDS.find((b) => b.arm === arm);
  if (!band) throw new Error(`overlapRate: unknown arm ${arm}`);

  const totalMinutes = (endMs - startMs) / MS_PER_MIN;
  let overlapMinutes = 0;

  let cursor = startMs;
  while (cursor < endMs) {
    const segStartMin = utcToMinutes(new Date(cursor), timezone);
    // End of the local day containing `cursor`.
    const dayEndMs = cursor + (MINUTES_PER_DAY - segStartMin) * MS_PER_MIN;
    const segEndMs = Math.min(dayEndMs, endMs);
    const segEndMin = segStartMin + (segEndMs - cursor) / MS_PER_MIN;

    overlapMinutes += Math.max(
      0,
      Math.min(segEndMin, band.end) - Math.max(segStartMin, band.start),
    );
    cursor = segEndMs;
  }

  return overlapMinutes / totalMinutes;
}
