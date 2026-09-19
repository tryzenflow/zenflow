import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import {
  Prisma,
  SchedulingModel,
  SessionEventType,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  BANDIT_EXPERIMENT_ID,
  BANDIT_MODEL_VERSION,
  PAIRWISE_SAMPLE_RATE,
} from "../scheduler/constants";
import { EVENT_MAP, type RecordProposalArgs } from "./experiment.types";
import {
  schedulerArmSelected,
  schedulerProposals,
} from "../observability/metrics";

/** The 50/50 primary-policy roll, plus the independent pairwise-sample roll. */
export interface PolicyAssignment {
  primaryPolicy: SchedulingModel;
  /** `true` on the `PAIRWISE_SAMPLE_RATE` fraction of events that also run the
   * non-primary placer purely for comparison — independent of `primaryPolicy`. */
  pairwiseShown: boolean;
  randomizationSeed: string;
}

/**
 * A/B experiment plumbing for heuristic-vs-LinUCB scheduling
 * (`docs/scheduler/ab-testing.md`). Assigns a 50/50 primary policy (and an
 * independent pairwise-sample roll) per scheduling event and records one
 * `SlotProposal` row. Every write is best-effort — a failure here must never
 * break session create/update.
 */
@Injectable()
export class ExperimentService {
  private readonly logger = new Logger(ExperimentService.name);

  constructor(private readonly prisma: PrismaService) {}

  private rollPrimaryPolicy(rng: () => number): SchedulingModel {
    return rng() < 0.5 ? SchedulingModel.LINUCB : SchedulingModel.HEURISTIC;
  }

  private rollPairwiseShown(rng: () => number): boolean {
    return rng() < PAIRWISE_SAMPLE_RATE;
  }

  private generateRandomizationSeed(): string {
    return randomBytes(16).toString("hex");
  }

  assignPolicy(rng: () => number = Math.random): PolicyAssignment {
    return {
      primaryPolicy: this.rollPrimaryPolicy(rng),
      pairwiseShown: this.rollPairwiseShown(rng),
      randomizationSeed: this.generateRandomizationSeed(),
    };
  }

  /** Writes the `SlotProposal` row, returning its id (`null` on failure) so
   * the caller can attribute a later `MOVE`/`RETAINED` reward to it. */
  async recordProposal(args: RecordProposalArgs): Promise<string | null> {
    try {
      const observationCount = await this.loadObservationCount(args.userId);
      const created = await this.prisma.slotProposal.create({
        data: this.buildProposalData(args, observationCount),
        select: { id: true },
      });
      this.emitProposalMetrics(args);
      return created.id;
    } catch (err) {
      this.logger.warn(
        `recordProposal failed for session=${args.sessionId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private loadObservationCount(userId: string): Promise<number> {
    return this.prisma.sessionEvent.count({
      where: {
        userId,
        eventType: { in: [SessionEventType.MOVE, SessionEventType.RETAINED] },
      },
    });
  }

  private buildProposalData(
    args: RecordProposalArgs,
    observationCount: number,
  ): Prisma.SlotProposalUncheckedCreateInput {
    const isLinucb = args.primaryPolicy === SchedulingModel.LINUCB;
    return {
      experimentId: BANDIT_EXPERIMENT_ID,
      event: EVENT_MAP[args.trigger],
      primaryPolicy: args.primaryPolicy,
      randomizationSeed: args.randomizationSeed,
      observationCount,
      heuristicProposal: args.heuristicProposal ?? {},
      modelProposal: args.modelProposal
        ? {
            scheduledStartTime:
              args.modelProposal.scheduledStartTime.toISOString(),
            selectedArm: args.modelProposal.selectedArm,
          }
        : Prisma.JsonNull,
      modelVersion: isLinucb ? BANDIT_MODEL_VERSION : null,
      proposedStartTime: args.proposedStartTime,
      featureVector: args.featureVector,
      selectedArm: args.selectedArm,
      pairwiseShown: args.pairwiseShown,
      pairwisePositions: args.pairwisePositions
        ? args.pairwisePositions
        : Prisma.JsonNull,
      userId: args.userId,
      sessionId: args.sessionId,
    };
  }

  private emitProposalMetrics(args: RecordProposalArgs): void {
    schedulerProposals.add(1, {
      policy: args.primaryPolicy,
      trigger: args.trigger,
    });
    if (args.selectedArm) {
      schedulerArmSelected.add(1, { arm: args.selectedArm });
    }
  }
}
