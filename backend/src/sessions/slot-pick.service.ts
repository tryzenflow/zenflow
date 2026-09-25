import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  SlotPickResponse,
  Session as SharedSession,
} from "@zenflow/shared";
import { SchedulingModel, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { MS_PER_MINUTE, overlapsAny } from "../scheduler/core/slot";
import { SchedulingFeedbackService } from "../scheduler/io/scheduling-feedback.service";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";
import { moveEventData } from "./session-events";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { SlotTakenException } from "./slot-taken.exception";

type LoadedProposal = {
  id: string;
  primaryPolicy: SchedulingModel;
  heuristicProposal: unknown;
  modelProposal: unknown;
  pairwiseShown: boolean;
  chosenByUser: SchedulingModel | null;
  firstModifiedAt: Date | null;
};

/**
 * `POST /sessions/:id/slot-pick` (`docs/scheduler/ab-testing.md` §3): records
 * which side of a shown pairwise comparison the user picked. `"alternative"`
 * applies the other policy's raw proposal as a `MOVE`; `"primary"` (or a
 * proposal with no pairwise comparison at all) just records "kept". Idempotent
 * — a proposal that already has `chosenByUser` set is a no-op that just
 * echoes what was recorded, never re-applying a move. An alternative that
 * overlaps another sitting of the same `TASK` series is refused with a 409
 * {@link SlotTakenException} and nothing is recorded (#58).
 */
@Injectable()
export class SlotPickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingFeedback: SchedulingFeedbackService,
  ) {}

  async recordPick(
    sessionId: string,
    dto: SlotPickDto,
    user: User,
  ): Promise<SlotPickResponse> {
    const proposal = await this.loadProposal(
      dto.slotProposalId,
      sessionId,
      user.id,
    );
    if (!proposal) return this.unchangedResponse(sessionId, user, null);

    if (proposal.chosenByUser) {
      return this.unchangedResponse(
        sessionId,
        user,
        this.sideOf(proposal, proposal.chosenByUser),
      );
    }

    if (dto.chose === "alternative") {
      const applied = await this.tryApplyAlternative(sessionId, proposal, user);
      if (applied) {
        await this.recordChosenPolicy(proposal.id, this.otherPolicy(proposal));
        return { session: applied, chosenByUser: "alternative" };
      }
    }

    await this.recordKeptPrimary(proposal);
    return {
      session: await this.currentSession(sessionId, user),
      chosenByUser: "primary",
    };
  }

  private loadProposal(
    slotProposalId: string,
    sessionId: string,
    userId: string,
  ): Promise<LoadedProposal | null> {
    return this.prisma.slotProposal.findFirst({
      where: { id: slotProposalId, sessionId, userId },
      select: {
        id: true,
        primaryPolicy: true,
        heuristicProposal: true,
        modelProposal: true,
        pairwiseShown: true,
        chosenByUser: true,
        firstModifiedAt: true,
      },
    });
  }

  private sideOf(
    proposal: LoadedProposal,
    chosen: SchedulingModel,
  ): "primary" | "alternative" {
    return chosen === proposal.primaryPolicy ? "primary" : "alternative";
  }

  private otherPolicy(proposal: LoadedProposal): SchedulingModel {
    return proposal.primaryPolicy === SchedulingModel.LINUCB
      ? SchedulingModel.HEURISTIC
      : SchedulingModel.LINUCB;
  }

  /** The other algorithm's raw pick — only present when this event was
   * actually pairwise-sampled. */
  private alternativeStart(proposal: LoadedProposal): Date | null {
    if (!proposal.pairwiseShown) return null;
    const source =
      proposal.primaryPolicy === SchedulingModel.LINUCB
        ? proposal.heuristicProposal
        : proposal.modelProposal;
    const iso = (source as { scheduledStartTime?: string } | null)
      ?.scheduledStartTime;
    return iso ? new Date(iso) : null;
  }

  private async tryApplyAlternative(
    sessionId: string,
    proposal: LoadedProposal,
    user: User,
  ): Promise<SharedSession | null> {
    const altStart = this.alternativeStart(proposal);
    if (!altStart) return null;
    await this.assertNoSiblingClash(sessionId, altStart, user);
    return this.moveSessionTo(sessionId, altStart, user);
  }

  /**
   * A series sitting's alternative came from an independent plan, and its
   * siblings may have moved since (#58): refuse (409 `SLOT_TAKEN`, nothing
   * recorded) when it would overlap any other live sitting of the series.
   */
  private async assertNoSiblingClash(
    sessionId: string,
    altStart: Date,
    user: User,
  ): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: user.id, deleted: false },
      select: { seriesId: true, durationMinutes: true },
    });
    if (!session?.seriesId) return;
    const siblings = await this.prisma.session.findMany({
      where: {
        seriesId: session.seriesId,
        userId: user.id,
        deleted: false,
        id: { not: sessionId },
        scheduledStartTime: { not: null },
      },
      select: { scheduledStartTime: true, durationMinutes: true },
    });
    const start = altStart.getTime();
    const occupied = siblings.map((s) => {
      const from = (s.scheduledStartTime as Date).getTime();
      return { start: from, end: from + s.durationMinutes * MS_PER_MINUTE };
    });
    if (
      overlapsAny(
        occupied,
        start,
        start + session.durationMinutes * MS_PER_MINUTE,
      )
    ) {
      throw new SlotTakenException();
    }
  }

  /** Applies the pick as an ordinary `MOVE` — same drag-distance grading and
   * delayed-reward path a manual drag takes ({@link SchedulingFeedbackService}). */
  private async moveSessionTo(
    sessionId: string,
    newStart: Date,
    user: User,
  ): Promise<SharedSession | null> {
    const existing = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!existing?.scheduledStartTime) return null;
    if (existing.scheduledStartTime.getTime() === newStart.getTime()) {
      return toSessionDto(existing);
    }

    const dragDistanceMinutes = Math.round(
      (newStart.getTime() - existing.scheduledStartTime.getTime()) / 60_000,
    );
    const isFirstMove = existing.lastMovedAt == null;

    const [row, moveEvent] = await this.prisma.$transaction(async (tx) => {
      const event = await tx.sessionEvent.create({
        data: moveEventData({
          sessionId,
          userId: user.id,
          oldStart: existing.scheduledStartTime as Date,
          oldDurationMinutes: existing.durationMinutes,
          newStart,
          newDurationMinutes: existing.durationMinutes,
          dragDistanceMinutes,
        }),
        select: { id: true },
      });
      const updated = await tx.session.update({
        where: { id: sessionId },
        data: { scheduledStartTime: newStart, lastMovedAt: new Date() },
        include: WITH_TAGS_AND_SERIES,
      });
      return [updated, event] as const;
    });

    if (isFirstMove) {
      await this.schedulingFeedback.onFirstMove(
        user.id,
        sessionId,
        moveEvent.id,
        dragDistanceMinutes,
      );
      await this.schedulingFeedback.reinforcePreferenceMove(
        user.id,
        existing.scheduledStartTime.getTime(),
        newStart.getTime(),
        user.timezone,
        dragDistanceMinutes,
      );
    }
    return toSessionDto(row);
  }

  private recordChosenPolicy(
    proposalId: string,
    policy: SchedulingModel,
  ): Promise<unknown> {
    return this.prisma.slotProposal.update({
      where: { id: proposalId },
      data: { chosenByUser: policy },
    });
  }

  private recordKeptPrimary(proposal: LoadedProposal): Promise<unknown> {
    return this.prisma.slotProposal.update({
      where: { id: proposal.id },
      data: {
        chosenByUser: proposal.primaryPolicy,
        ...(proposal.firstModifiedAt
          ? {}
          : { acceptedWithoutModification: true }),
      },
    });
  }

  private async currentSession(
    sessionId: string,
    user: User,
  ): Promise<SharedSession> {
    const row = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: user.id, deleted: false },
      include: WITH_TAGS_AND_SERIES,
    });
    if (!row)
      throw new NotFoundException(`Cannot find session with id ${sessionId}`);
    return toSessionDto(row);
  }

  private async unchangedResponse(
    sessionId: string,
    user: User,
    chosenByUser: "primary" | "alternative" | null,
  ): Promise<SlotPickResponse> {
    return {
      session: await this.currentSession(sessionId, user),
      chosenByUser,
    };
  }
}
