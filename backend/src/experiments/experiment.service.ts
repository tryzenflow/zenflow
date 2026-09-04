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
} from "../scheduler/constants";
import { EVENT_MAP, type RecordProposalArgs } from "./experiment.types";

/**
 * A/B experiment plumbing for heuristic-vs-LinUCB scheduling
 * (`docs/scheduler/ab-testing.md`). Assigns a 50/50 primary policy per
 * scheduling event and records one `SlotProposal` row. Every write is
 * best-effort — a failure here must never break session create/update.
 */
@Injectable()
export class ExperimentService {
  private readonly logger = new Logger(ExperimentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 50/50 primary-policy assignment with a logged randomization seed. */
  assignPolicy(rng: () => number = Math.random): {
    primaryPolicy: SchedulingModel;
    randomizationSeed: string;
  } {
    return {
      primaryPolicy:
        rng() < 0.5 ? SchedulingModel.LINUCB : SchedulingModel.HEURISTIC,
      randomizationSeed: randomBytes(16).toString("hex"),
    };
  }

  async recordProposal(args: RecordProposalArgs): Promise<void> {
    try {
      const observationCount = await this.prisma.sessionEvent.count({
        where: {
          userId: args.userId,
          eventType: {
            in: [SessionEventType.MOVE, SessionEventType.RETAINED],
          },
        },
      });

      const isLinucb = args.primaryPolicy === SchedulingModel.LINUCB;

      await this.prisma.slotProposal.create({
        data: {
          experimentId: BANDIT_EXPERIMENT_ID,
          event: EVENT_MAP[args.trigger],
          primaryPolicy: args.primaryPolicy,
          randomizationSeed: args.randomizationSeed,
          observationCount,
          heuristicProposal:
            (args.heuristicProposal as unknown as Prisma.InputJsonValue) ?? {},
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
          userId: args.userId,
          sessionId: args.sessionId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `recordProposal failed for session=${args.sessionId}: ${(err as Error).message}`,
      );
    }
  }
}
