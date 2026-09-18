import { Injectable, Logger } from "@nestjs/common";
import {
  SchedulingModel,
  SessionEventType,
  type SchedulingArm,
} from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { BanditService } from "../../bandit/bandit.service";
import { dragDistanceReward } from "../core/reward";
import { reinforcePreferenceCell } from "../core/preference";
import { withLockedPreferenceMatrix } from "./preference-matrix-lock";

/** The one `SlotProposal` fields this service ever reads/writes. */
type LinucbProposal = {
  id: string;
  selectedArm: SchedulingArm | null;
  featureVector: number[];
  firstModifiedAt: Date | null;
};

/**
 * Delayed LinUCB reward for the FIRST user move of a session that a LinUCB
 * `SlotProposal` placed (ADR-0001 §7/§9), and the `SlotProposal` acceptance
 * columns (`firstModifiedAt` / `firstModificationType` /
 * `acceptedWithoutModification`) that first modification stamps. Every step
 * is best-effort — a bandit failure never breaks the session update.
 *
 * The `RETAINED` half of the same reward loop lives in
 * {@link RetainedSessionsService}, which calls {@link applyDelayedReward}
 * directly — both paths share the same "find the LinUCB proposal, fold the
 * reward in, link the event back" logic.
 */
@Injectable()
export class SchedulingFeedbackService {
  private readonly logger = new Logger(SchedulingFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bandit: BanditService,
    private readonly armStates: BanditArmStateRepository,
  ) {}

  /** A user drag/resize (or a pairwise pick that switches to the
   * alternative) away from a session's placed start — a negative signal
   * graded by displacement. This is the session's first modification. */
  async onFirstMove(
    userId: string,
    sessionId: string,
    moveEventId: bigint,
    dragDistanceMinutes: number,
  ): Promise<void> {
    await this.applyDelayedReward(
      userId,
      sessionId,
      moveEventId,
      dragDistanceReward(dragDistanceMinutes),
      SessionEventType.MOVE,
    );
  }

  /**
   * Shared delayed-reward path for both the first-`MOVE` (drag/pick) and
   * `RETAINED` (cron) signals: finds the LinUCB `SlotProposal` behind
   * `sessionId` — `null` when the applied placement wasn't LinUCB's, per the
   * off-policy correctness rule (a proposal only gets rewarded for the
   * outcome of the arm it actually placed) — folds `reward` into that arm's
   * state, links `eventId` back to the proposal, and (when `modificationType`
   * is given) stamps the proposal's acceptance columns if not already set.
   * Never throws.
   */
  async applyDelayedReward(
    userId: string,
    sessionId: string,
    eventId: bigint,
    reward: number,
    modificationType: SessionEventType | null,
  ): Promise<void> {
    try {
      const proposal = await this.loadLinucbProposal(sessionId);
      if (!proposal?.selectedArm) return;

      await this.pushBanditUpdate(
        userId,
        proposal.selectedArm,
        proposal.featureVector,
        reward,
      );
      await this.linkEvent(eventId, proposal.id);
      if (modificationType) {
        await this.markAcceptanceOnModification(proposal, modificationType);
      }
    } catch (err) {
      this.logger.warn(
        `bandit feedback failed for session ${sessionId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  private loadLinucbProposal(
    sessionId: string,
  ): Promise<LinucbProposal | null> {
    return this.prisma.slotProposal.findFirst({
      where: {
        sessionId,
        primaryPolicy: SchedulingModel.LINUCB,
        selectedArm: { not: null },
      },
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        selectedArm: true,
        featureVector: true,
        firstModifiedAt: true,
      },
    });
  }

  private async pushBanditUpdate(
    userId: string,
    arm: SchedulingArm,
    featureVector: number[],
    reward: number,
  ): Promise<void> {
    const state = (await this.armStates.loadAll(userId))[arm];
    const res = await this.bandit.update(arm, featureVector, reward, {
      A: state.A,
      b: state.b,
    });
    if (res) {
      await this.armStates.save(userId, arm, res.A, res.b, state.version);
    }
  }

  /**
   * Additive preference-matrix reinforcement (Item 3B3) — `+1` for a kept
   * (`RETAINED`) placement, `-1` for a session's first `MOVE` away from one.
   * Unlike {@link applyDelayedReward} (gated behind "was there a LinUCB
   * `SlotProposal`"), this runs UNCONDITIONALLY on which policy placed the
   * session: `User.preferenceMatrix` is read by both the heuristic
   * (`bestFreeSlot`, full weight) and LinUCB's post-hoc rerank nudge
   * (`PREFERENCE_NUDGE_WEIGHT`), so both policies' outcomes should feed it.
   * Read-modify-write is row-locked (`withLockedPreferenceMatrix`) against
   * the nightly `MatrixDecayService` cron's own read-modify-write of the same
   * whole-array column. Never throws — best-effort, like every other
   * feedback path here.
   */
  async reinforcePreferenceMatrix(
    userId: string,
    atMs: number,
    timezone: string,
    delta: 1 | -1,
  ): Promise<void> {
    try {
      await withLockedPreferenceMatrix(this.prisma, userId, async (row, tx) => {
        const next = reinforcePreferenceCell(
          row.preferenceMatrix,
          atMs,
          timezone,
          delta,
        );
        await tx.user.update({
          where: { id: userId },
          data: { preferenceMatrix: next },
        });
      });
    } catch (err) {
      this.logger.warn(
        `preference reinforcement failed for user ${userId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  private linkEvent(eventId: bigint, proposalId: string): Promise<unknown> {
    return this.prisma.sessionEvent.update({
      where: { id: eventId },
      data: { slotProposalId: proposalId, policy: SchedulingModel.LINUCB },
    });
  }

  /** First modification wins — a proposal that already has `firstModifiedAt`
   * keeps it, whichever path (drag, pick, or an earlier call here) set it. */
  private markAcceptanceOnModification(
    proposal: LinucbProposal,
    modificationType: SessionEventType,
  ): Promise<unknown> {
    if (proposal.firstModifiedAt) return Promise.resolve(undefined);
    return this.prisma.slotProposal.update({
      where: { id: proposal.id },
      data: {
        firstModifiedAt: new Date(),
        firstModificationType: modificationType,
        acceptedWithoutModification: false,
      },
    });
  }
}
