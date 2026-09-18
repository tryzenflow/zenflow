import { Injectable } from "@nestjs/common";
import { SchedulingModel } from "../../../generated/prisma";
import {
  ExperimentService,
  type PolicyAssignment,
} from "../../experiments/experiment.service";
import type {
  ExperimentTrigger,
  PairwisePosition,
} from "../../experiments/experiment.types";
import type { AppliedPolicy, BanditPick } from "../types/placement.types";

export interface ExperimentPlacementInput {
  userId: string;
  sessionId: string;
  trigger: ExperimentTrigger;
  heuristicStart: Date | null;
  runBandit: () => Promise<BanditPick | null>;
}

export interface ExperimentPlacementOutcome {
  appliedStart: Date | null;
  appliedPolicy: AppliedPolicy;
  assignedPolicy: SchedulingModel;
  banditAttempted: boolean;
  banditPick: BanditPick | null;
  slotProposalId: string | null;
  alternativeSlot: Date | null;
  divergent: boolean;
}

interface Divergence {
  effectivePairwiseShown: boolean;
  alternativeSlot: Date | null;
  divergent: boolean;
}

/**
 * Runs the heuristic-vs-LinUCB A/B assignment for one placement event: rolls
 * the 50/50 primary policy and the independent pairwise-sample roll
 * (`ExperimentService.assignPolicy`), decides whether the non-primary placer
 * needs to run too (either it's primary, or this event was pairwise-sampled),
 * picks the winning slot, works out the divergent "other side" slot for the
 * pairwise UI, and records the `SlotProposal` row. Extracted out of
 * {@link TaskPlacementService} so that placer stays focused on persistence.
 */
@Injectable()
export class SchedulingExperimentCoordinator {
  constructor(private readonly experiment: ExperimentService) {}

  async run(
    input: ExperimentPlacementInput,
    rng: () => number = Math.random,
  ): Promise<ExperimentPlacementOutcome> {
    const assignment = this.experiment.assignPolicy(rng);
    const banditAttempted = this.shouldRunBandit(assignment);
    const banditPick = banditAttempted ? await input.runBandit() : null;

    const { appliedStart, appliedPolicy } = this.pickWinner(
      assignment.primaryPolicy,
      input.heuristicStart,
      banditPick,
    );
    const divergence = this.buildDivergence(
      assignment,
      input.heuristicStart,
      banditPick,
      appliedStart,
    );
    const slotProposalId = await this.recordProposal(
      input,
      assignment,
      banditPick,
      appliedStart,
      divergence,
      rng,
    );

    return {
      appliedStart,
      appliedPolicy,
      assignedPolicy: assignment.primaryPolicy,
      banditAttempted,
      banditPick,
      slotProposalId,
      alternativeSlot: divergence.alternativeSlot,
      divergent: divergence.divergent,
    };
  }

  /** LinUCB always runs when it's primary; otherwise it only runs if this
   * event was sampled for the pairwise comparison. */
  private shouldRunBandit(assignment: PolicyAssignment): boolean {
    return (
      assignment.primaryPolicy === SchedulingModel.LINUCB ||
      assignment.pairwiseShown
    );
  }

  private pickWinner(
    primaryPolicy: SchedulingModel,
    heuristicStart: Date | null,
    banditPick: BanditPick | null,
  ): { appliedStart: Date | null; appliedPolicy: AppliedPolicy } {
    if (primaryPolicy === SchedulingModel.LINUCB && banditPick) {
      return {
        appliedStart: banditPick.scheduledStartTime,
        appliedPolicy: "LINUCB",
      };
    }
    return {
      appliedStart: heuristicStart,
      appliedPolicy: heuristicStart ? "HEURISTIC" : "NONE",
    };
  }

  /** The pairwise comparison only actually happened if the non-primary
   * placer's run produced a bandit pick to compare against — a sampled event
   * where LinUCB came back empty has nothing to show. */
  private buildDivergence(
    assignment: PolicyAssignment,
    heuristicStart: Date | null,
    banditPick: BanditPick | null,
    appliedStart: Date | null,
  ): Divergence {
    const effectivePairwiseShown =
      assignment.pairwiseShown && banditPick !== null;
    if (!effectivePairwiseShown) {
      return {
        effectivePairwiseShown,
        alternativeSlot: null,
        divergent: false,
      };
    }

    const rawAlternative =
      assignment.primaryPolicy === SchedulingModel.LINUCB
        ? heuristicStart
        : (banditPick?.scheduledStartTime ?? null);
    const divergent =
      rawAlternative !== null &&
      appliedStart !== null &&
      rawAlternative.getTime() !== appliedStart.getTime();

    return {
      effectivePairwiseShown,
      alternativeSlot: divergent ? rawAlternative : null,
      divergent,
    };
  }

  private randomizePairwisePositions(rng: () => number): {
    primaryPosition: PairwisePosition;
  } {
    return { primaryPosition: rng() < 0.5 ? "first" : "second" };
  }

  private recordProposal(
    input: ExperimentPlacementInput,
    assignment: PolicyAssignment,
    banditPick: BanditPick | null,
    appliedStart: Date | null,
    divergence: Divergence,
    rng: () => number,
  ): Promise<string | null> {
    return this.experiment.recordProposal({
      userId: input.userId,
      sessionId: input.sessionId,
      trigger: input.trigger,
      primaryPolicy: assignment.primaryPolicy,
      randomizationSeed: assignment.randomizationSeed,
      heuristicProposal: {
        scheduledStartTime: input.heuristicStart?.toISOString() ?? null,
      },
      proposedStartTime: appliedStart,
      modelProposal: banditPick
        ? {
            scheduledStartTime: banditPick.scheduledStartTime,
            selectedArm: banditPick.selectedArm,
          }
        : null,
      featureVector: banditPick?.featureVector ?? [],
      selectedArm: banditPick?.selectedArm ?? null,
      pairwiseShown: divergence.effectivePairwiseShown,
      pairwisePositions: divergence.effectivePairwiseShown
        ? this.randomizePairwisePositions(rng)
        : null,
    });
  }
}
