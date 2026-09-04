import type { SchedulingArm } from "@zenflow/shared";
import type { Interval } from "../core/slot";

/**
 * Shared types for the placement layer (`io/*.service.ts`): the pure-core →
 * concrete-timestamp mapping (`docs/scheduler/reranking.md`) and the
 * `sessions/`-facing result shapes.
 */

/** The minimal task shape every placer needs. */
export interface PlaceableTask {
  id: string;
  durationMinutes: number;
  deadline: Date;
}

/** An already-clamped local-day candidate range, inclusive on both ends. */
export interface PlacementWindow {
  /** Local 'YYYY-MM-DD' of the first candidate day. */
  firstDayStr: string;
  /** Local 'YYYY-MM-DD' of the last candidate day. */
  lastDayStr: string;
}

/** A concrete free slot with its preference/score value. */
export interface ScoredSlot {
  start: Date;
  score: number;
}

/** Which policy produced the applied placement. */
export type AppliedPolicy = "HEURISTIC" | "LINUCB" | "NONE";

/** The outcome of placing one single `TASK`. */
export interface PlacementResult {
  scheduledStartTime: Date | null;
  appliedPolicy: AppliedPolicy;
}

/** One member of a `TASK` series to place. */
export interface SeriesMemberInput {
  id: string;
  durationMinutes: number;
}

/** Placement outcome for one series member — `null` when nothing free fit. */
export interface SeriesPlacementRow {
  id: string;
  scheduledStartTime: Date | null;
}

/** The concrete placement LinUCB proposes for one `TASK`. */
export interface BanditPick {
  scheduledStartTime: Date;
  selectedArm: SchedulingArm;
  /** The length-`d` context vector for the chosen day. */
  featureVector: number[];
}

/** One scanned candidate day: its bounds, what occupies it, and its context vector. */
export interface CandidateDay {
  dayStr: string;
  dayStartMs: number;
  /** Local midnight of the NEXT day — exclusive per-day ceiling. */
  dayEndMs: number;
  occupied: Interval[];
  vector: number[];
}
