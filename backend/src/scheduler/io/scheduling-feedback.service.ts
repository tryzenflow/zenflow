import { Injectable, Logger } from "@nestjs/common";
import { SchedulingModel } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { BanditService } from "../../bandit/bandit.service";
import { MOVE_REWARD_SCALE_MINUTES } from "../constants";

/**
 * Delayed LinUCB reward for the FIRST user move of a session that a LinUCB
 * `SlotProposal` placed (ADR-0001 §7/§9). Graded by displacement from the
 * proposed start; links the `MOVE` `SessionEvent` back to the proposal. Every
 * step is best-effort — a bandit failure never breaks the session update.
 *
 * The `RETAINED` half of the same reward loop lives in
 * {@link RetainedSessionsService}; both call the bandit `/update`.
 */
@Injectable()
export class SchedulingFeedbackService {
  private readonly logger = new Logger(SchedulingFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bandit: BanditService,
    private readonly armStates: BanditArmStateRepository,
  ) {}

  async onFirstMove(
    userId: string,
    sessionId: string,
    moveEventId: bigint,
    dragDistanceMinutes: number,
  ): Promise<void> {
    try {
      const proposal = await this.prisma.slotProposal.findFirst({
        where: {
          sessionId,
          primaryPolicy: SchedulingModel.LINUCB,
          selectedArm: { not: null },
        },
        orderBy: { timestamp: "desc" },
      });
      if (!proposal?.selectedArm) return;

      const reward =
        dragDistanceMinutes === 0
          ? 0
          : -Math.min(
              1,
              Math.abs(dragDistanceMinutes) / MOVE_REWARD_SCALE_MINUTES,
            );
      const arm = proposal.selectedArm;
      const state = (await this.armStates.loadAll(userId))[arm];
      const res = await this.bandit.update(
        arm,
        proposal.featureVector,
        reward,
        {
          A: state.A,
          b: state.b,
        },
      );
      if (res) {
        await this.armStates.save(userId, arm, res.A, res.b, state.version);
      }
      await this.prisma.sessionEvent.update({
        where: { id: moveEventId },
        data: {
          slotProposalId: proposal.id,
          policy: SchedulingModel.LINUCB,
        },
      });
    } catch (err) {
      this.logger.warn(
        `bandit MOVE feedback failed for session ${sessionId}: ${
          (err as Error).message
        }`,
      );
    }
  }
}
