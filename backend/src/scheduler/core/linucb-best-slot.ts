import type { SchedulingArm } from "@zenflow/shared";
import { ARM_BANDS, armOfMinute } from "./arms";
import { slotPreferenceScore, stabilityScore } from "./slot-score";
import { PREFERENCE_NUDGE_WEIGHT, STABILITY_WEIGHT } from "../constants";
import { utcToMinutes } from "../../common/utils";
import {
  ceilToSlot,
  MS_PER_MINUTE,
  overlapsAny,
  SLOT_MS,
  type Interval,
} from "./slot";

const HOUR_MS = 60 * MS_PER_MINUTE;

/**
 * Two-step LinUCB slot search over a pre-scored set of candidate days — pure,
 * no I/O, no clock, no randomness (CLAUDE.md invariant 2). Extracted from
 * `BanditPlacer`'s own scan (`io/bandit-placer.service.ts`) so the same "arm
 * scores → concrete best slot" math has exactly one implementation, reachable
 * by both the real placer and anything else that needs to reproduce it (e.g.
 * the offline simulator's TS bridge, `backend/scripts/simulation-bridge.ts`).
 *
 * Item 3B2: arm choice and minute choice are now separate steps —
 * {@link rankArmsByScore} picks the arm from LinUCB's own per-arm scores
 * alone, then {@link bestMinuteInArm} searches only within that arm's time
 * window, scored by the Item 3B1 preference nudge + Item 4's stability term.
 * `bestLinucbSlot` orchestrates the two, falling through to the next-ranked
 * arm when the current one has zero feasible slots anywhere in the horizon.
 */

export interface LinucbCandidateDay {
  dayStr: string;
  dayStartMs: number;
  dayEndMs: number;
  occupied: Interval[];
  /** This day's context vector — echoed back on the winning day's slot. */
  vector: number[];
  /** Per-arm LinUCB scores for this day (`/predict`'s output; missing arm → 0). */
  armScores: Partial<Record<SchedulingArm, number>>;
}

export interface BestLinucbSlotInput {
  days: LinucbCandidateDay[];
  durationMinutes: number;
  timezone: string;
  /** The user's flat 168-cell preference matrix (D4 cold-start blend). */
  prefMatrix: number[];
  /** Earliest legal start (`ceilToSlot(now)`, typically). */
  nextMs: number;
  deadlineMs: number;
  /** Extra hard blocks on top of each day's own occupancy (series siblings). */
  extraOccupied?: Interval[];
  prevStartMs?: number;
}

export interface BestLinucbSlot {
  startMs: number;
  score: number;
  arm: SchedulingArm;
  vector: number[];
}

/**
 * Ranks every `SchedulingArm` by LinUCB's own score alone — no preference or
 * stability influence (Item 3B2 step 1). An arm's potential is the best
 * (max) `/predict` score it reaches on ANY candidate day — matching the
 * existing "always take the single best point reachable, never an average"
 * philosophy `bestFreeSlot`/the old `bestLinucbSlot` already use (earliest
 * start, highest score, no averaging). This does NOT commit to that day —
 * step 2 searches every day within the chosen arm, so a day that happens to
 * be fully booked in this arm's band doesn't wrongly evict the arm; only
 * "every day exhausted" does (see {@link bestMinuteInArm}).
 *
 * Deterministic tie-break: exact score ties fall back to `ARM_BANDS`'
 * declared order (EARLY_MORNING → NIGHT) — arbitrary but fixed, matching the
 * no-randomness invariant (CLAUDE.md). `Array.prototype.sort` is stable in
 * Node/V8, so a `0`-returning comparator on ties preserves the `ARM_BANDS`-
 * order input — no separate tiebreak key needed, but spelled out here since
 * it's easy to "fix" into a bug later.
 */
export function rankArmsByScore(days: LinucbCandidateDay[]): SchedulingArm[] {
  const potential = new Map<SchedulingArm, number>();
  for (const band of ARM_BANDS) {
    let best = -Infinity;
    for (const day of days) {
      const s = day.armScores[band.arm] ?? 0;
      if (s > best) best = s;
    }
    potential.set(band.arm, best);
  }
  return ARM_BANDS.map((b) => b.arm)
    .slice()
    .sort((a, b) => potential.get(b)! - potential.get(a)! || 0);
}

export interface ArmMinutePick {
  startMs: number;
  dayStr: string;
  score: number;
}

/**
 * Scans every 15-minute-aligned start, across every day in `days`, whose
 * local minute-of-day falls inside `arm`'s own band (`armOfMinute`) — Item
 * 3B2 step 2. Feasible candidates (not `occupied`, within `[nextMs,
 * deadlineMs)`) are scored by the B1 preference nudge + Item 4's corrected
 * stability term ONLY — no arm term, because the arm is already fixed.
 * Highest score wins; earliest start breaks ties (existing convention).
 * `null` when this arm has zero feasible slots anywhere in the horizon — the
 * caller falls through to the next-ranked arm.
 *
 * A session's **end** may still run past the arm's own band boundary or past
 * local midnight exactly as today (D5) — only the **start** is constrained
 * to the chosen arm. This is also, by definition, now the sole and
 * authoritative rule for "which arm hosts this session" — no more post-hoc
 * inference from overlap contribution.
 */
export function bestMinuteInArm(
  arm: SchedulingArm,
  days: LinucbCandidateDay[],
  durationMinutes: number,
  timezone: string,
  prefMatrix: number[],
  nextMs: number,
  deadlineMs: number,
  extraOccupied: Interval[],
  prevStartMs?: number,
): ArmMinutePick | null {
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const overhangMs = durationMs - SLOT_MS;
  let best: ArmMinutePick | null = null;

  for (const day of days) {
    const lowerMs = Math.max(ceilToSlot(day.dayStartMs), nextMs);
    const upperMs = Math.min(day.dayEndMs + overhangMs, deadlineMs);
    const occupied = extraOccupied.length
      ? [...day.occupied, ...extraOccupied]
      : day.occupied;

    for (
      let startMs = lowerMs;
      startMs + durationMs <= upperMs;
      startMs += SLOT_MS
    ) {
      if (armOfMinute(utcToMinutes(new Date(startMs), timezone)) !== arm)
        continue;
      const endMs = startMs + durationMs;
      if (overlapsAny(occupied, startMs, endMs)) continue;

      const durationHours = durationMs / HOUR_MS;
      const nudge =
        (slotPreferenceScore(prefMatrix, startMs, endMs, timezone) /
          durationHours) *
        PREFERENCE_NUDGE_WEIGHT;
      const stability = prevStartMs
        ? STABILITY_WEIGHT * stabilityScore(prevStartMs, startMs) // Item 4's corrected sign
        : 0;
      const score = nudge + stability;

      if (
        best === null ||
        score > best.score ||
        (score === best.score && startMs < best.startMs)
      ) {
        best = { startMs, dayStr: day.dayStr, score };
      }
    }
  }
  return best;
}

/**
 * Ranks arms purely by LinUCB (step 1), then tries each in ranked order,
 * searching only within that arm's time window (step 2) — falling through to
 * the next-ranked arm when the current one has zero feasible slots anywhere
 * in the horizon. `null` only once every arm has been exhausted — the same
 * "nothing survives at all" contract callers already handle
 * (`BanditPlacer.placeInWindow` returns `null`, and `TaskPlacementService`
 * falls back to `HeuristicPlacer`). No new fallback plumbing needed.
 */
export function bestLinucbSlot(
  input: BestLinucbSlotInput,
): BestLinucbSlot | null {
  const {
    days,
    durationMinutes,
    timezone,
    prefMatrix,
    nextMs,
    deadlineMs,
    extraOccupied = [],
    prevStartMs,
  } = input;

  const rankedArms = rankArmsByScore(days);
  for (const arm of rankedArms) {
    const pick = bestMinuteInArm(
      arm,
      days,
      durationMinutes,
      timezone,
      prefMatrix,
      nextMs,
      deadlineMs,
      extraOccupied,
      prevStartMs,
    );
    if (pick) {
      const day = days.find((d) => d.dayStr === pick.dayStr)!;
      return {
        startMs: pick.startMs,
        score: pick.score,
        arm,
        vector: day.vector,
      };
    }
  }
  return null;
}
