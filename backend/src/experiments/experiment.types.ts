import type { SchedulingArm } from "@zenflow/shared";
import { SchedulingModel, SlotProposalEvent } from "../../generated/prisma";

/** What triggered a scheduling event that gets an A/B `SlotProposal` row. */
export type ExperimentTrigger = "create" | "deadline-change";

/** {@link ExperimentTrigger} → the persisted `SlotProposalEvent` enum value. */
export const EVENT_MAP: Record<ExperimentTrigger, SlotProposalEvent> = {
  create: SlotProposalEvent.CREATE,
  "deadline-change": SlotProposalEvent.DEADLINE_CHANGE,
};

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
}
