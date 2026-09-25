import type { SchedulingArm } from "@zenflow/shared";
import {
  PlacementSource,
  SchedulingModel,
  SlotProposalEvent,
} from "../../generated/prisma";

/** What triggered a scheduling event that gets an A/B `SlotProposal` row. */
export type ExperimentTrigger = "create" | "deadline-change";

/** {@link ExperimentTrigger} → the persisted `SlotProposalEvent` enum value. */
export const EVENT_MAP: Record<ExperimentTrigger, SlotProposalEvent> = {
  create: SlotProposalEvent.CREATE,
  "deadline-change": SlotProposalEvent.DEADLINE_CHANGE,
};

/** Which side of a pairwise comparison the primary policy's slot was shown on. */
export type PairwisePosition = "first" | "second";

export interface RecordProposalArgs {
  userId: string;
  sessionId: string;
  trigger: ExperimentTrigger;
  primaryPolicy: SchedulingModel;
  randomizationSeed: string;
  /** The preference-heuristic's own slot pick (always recorded, both policies). */
  heuristicProposal: { scheduledStartTime: string | null };
  /** The concrete start the primary policy placed this session at. */
  proposedStartTime: Date | null;
  /** The LinUCB pick, when the primary policy was LinUCB and it produced one. */
  modelProposal: {
    scheduledStartTime: Date;
    selectedArm: SchedulingArm;
  } | null;
  /** The length-`d` context vector behind `modelProposal` (empty otherwise). */
  featureVector: number[];
  /** The arm behind `modelProposal` (null otherwise). */
  selectedArm: SchedulingArm | null;
  /** Applied slot-score weights (`wL`/`wS`) of the LinUCB pick; null for heuristic. */
  weights?: { wL: number; wS: number } | null;
  /** Whether this event ran BOTH placers purely for comparison (`PAIRWISE_SAMPLE_RATE`). */
  pairwiseShown: boolean;
  /** Set only when `pairwiseShown` — which side the primary policy's slot was shown on. */
  pairwisePositions: { primaryPosition: PairwisePosition } | null;
  /** Which implementation produced the placement (ADR-0003); default `PYTHON`. */
  placementSource?: PlacementSource;
  /** Why the frozen TS fallback answered (`timeout`, `breaker_open`, ...); null otherwise. */
  degradedReason?: string | null;
  /** Overrides the stamped `modelVersion` (Python `paramsVersion`; `null` for the fallback). */
  modelVersion?: string | null;
}
