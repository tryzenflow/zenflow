import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  ConfirmPlacementResponse,
  DisplacedSession,
  PlacementMove,
  Session as SharedSession,
  UndoPlacementResponse,
} from "@zenflow/shared";
import { SessionEventType, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { wouldConflict } from "../scheduler/io/conflict-check";
import { DisplacementService } from "../scheduler/io/displacement.service";
import { RemindersService } from "../reminders/reminders.service";
import { MS_PER_MINUTE } from "../scheduler/core/slot";
import { CreateSessionDto } from "./dto/create-session.dto";
import { SessionCrudService } from "./session-crud.service";
import { toSessionDto } from "./session-mapper";
import { WITH_TAGS_AND_SERIES, type SessionRow } from "./types/session-row";
import { PlacementStaleException } from "./placement-plan.exception";

/** A session a plan moves must not have started within this window (ADR-0022). */
const FROZEN_WINDOW_MS = 2 * 60 * MS_PER_MINUTE;

/**
 * Event types an undo group reverts: the moves a placement or a drag wrote,
 * and the create that started a placement (removed again, as a user delete).
 */
const UNDOABLE_EVENT_TYPES = [
  SessionEventType.CREATE,
  SessionEventType.MOVE,
  SessionEventType.SYSTEM_MOVE,
];

/**
 * Confirmation and undo of scheduler moves (ADR-0022).
 *
 * - {@link confirm}: applies a stored plan atomically: the placed session
 *   (inserted from its create input when the plan came from a create), then
 *   every move, all under one undo group. A plan is single-use and is
 *   discarded when it no longer holds.
 * - {@link undo}: puts every session an undo group moved back on its previous
 *   start. A session moved again since keeps its current start.
 */
@Injectable()
export class PlacementPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly displacement: DisplacementService,
    private readonly crud: SessionCrudService,
    private readonly reminders: RemindersService,
  ) {}

  async confirm(
    user: User,
    planId: string,
    now: Date = new Date(),
  ): Promise<ConfirmPlacementResponse> {
    const plan = await this.prisma.placementPlan.findFirst({
      where: { id: planId, userId: user.id },
    });
    if (!plan) throw new NotFoundException("Placement plan not found");
    // Single use: the first confirm to claim the row wins.
    const claimed = await this.prisma.placementPlan.deleteMany({
      where: { id: planId, userId: user.id },
    });
    if (claimed.count !== 1) {
      throw new NotFoundException("Placement plan not found");
    }
    if (plan.expiresAt.getTime() <= now.getTime()) {
      throw new PlacementStaleException();
    }

    const createInput = plan.createInput as unknown as CreateSessionDto | null;
    if (!plan.subjectId && !createInput) throw new PlacementStaleException();

    const moves = plan.moves as unknown as PlacementMove[];
    const rows = await this.prisma.session.findMany({
      where: {
        id: {
          in: [
            ...moves.map((m) => m.id),
            ...(plan.subjectId ? [plan.subjectId] : []),
          ],
        },
        userId: user.id,
        deleted: false,
      },
      select: { id: true, durationMinutes: true, scheduledStartTime: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const durationOf = (id: string) => byId.get(id)?.durationMinutes ?? 15;

    // Each moved session must still sit where the plan found it, and not have
    // become frozen since.
    for (const m of moves) {
      const row = byId.get(m.id);
      if (
        !row?.scheduledStartTime ||
        row.scheduledStartTime.getTime() !== m.fromMs ||
        m.fromMs < now.getTime() + FROZEN_WINDOW_MS
      ) {
        throw new PlacementStaleException();
      }
    }
    const subject = plan.subjectId ? byId.get(plan.subjectId) : undefined;
    if (plan.subjectId) {
      if (
        !subject?.scheduledStartTime ||
        (plan.subjectFrom &&
          subject.scheduledStartTime.getTime() !== plan.subjectFrom.getTime())
      ) {
        throw new PlacementStaleException();
      }
    }

    // Every target must be free once the moved sessions have left their slots.
    const excluded = [
      ...moves.map((m) => m.id),
      ...(plan.subjectId ? [plan.subjectId] : []),
    ];
    const targets = [
      {
        start: plan.startAt,
        durationMinutes:
          subject?.durationMinutes ?? createInput?.durationMinutes,
      },
      ...moves.map((m) => ({
        start: new Date(m.toMs),
        durationMinutes: durationOf(m.id),
      })),
    ];
    for (const t of targets) {
      if (t.durationMinutes === undefined) throw new PlacementStaleException();
      const clash = await wouldConflict(this.prisma, {
        userId: user.id,
        timezone: user.timezone,
        start: t.start,
        durationMinutes: t.durationMinutes,
        excludeSessionIds: excluded,
      });
      if (clash) throw new PlacementStaleException();
    }

    const groupId = randomUUID();
    const moveList = moves.map((m) => ({
      id: m.id,
      fromMs: m.fromMs,
      toMs: m.toMs,
    }));

    const row = await this.prisma.$transaction(async (tx) => {
      let placed: SessionRow;
      if (subject?.scheduledStartTime) {
        await this.runWrites(
          this.displacement.moveWrites(
            tx,
            user.id,
            [
              {
                id: subject.id,
                fromMs: subject.scheduledStartTime.getTime(),
                toMs: plan.startAt.getTime(),
              },
            ],
            durationOf,
            groupId,
          ),
        );
        placed = await tx.session.findFirstOrThrow({
          where: { id: subject.id },
          include: WITH_TAGS_AND_SERIES,
        });
      } else {
        const cleanTags = (createInput?.tags ?? [])
          .map((t) => t.trim())
          .filter(Boolean);
        const inserted = await this.crud.insertSingleTask(
          tx,
          user,
          createInput as CreateSessionDto,
          cleanTags,
          new Date(createInput?.deadline as string),
          groupId,
        );
        placed = await tx.session.update({
          where: { id: inserted.id },
          data: { scheduledStartTime: plan.startAt },
          include: WITH_TAGS_AND_SERIES,
        });
      }
      await this.runWrites(
        this.displacement.moveWrites(
          tx,
          user.id,
          moveList,
          durationOf,
          groupId,
        ),
      );
      return placed;
    });

    let session: SharedSession = toSessionDto(row);
    if (!plan.subjectId && createInput) {
      // A create gets the reminders its request asked for, as a direct create does.
      const minutes = this.reminders.resolveForCreate(
        createInput.type,
        createInput.reminders,
        user.defaultReminderMinutes,
      );
      const { applied } = await this.reminders.replace([row.id], minutes);
      session = { ...session, reminders: applied };
    }

    return {
      session,
      displacedSessions: moves.map((m) => ({
        id: m.id,
        from: new Date(m.fromMs).toISOString(),
        to: new Date(m.toMs).toISOString(),
      })),
      undoGroupId: groupId,
    };
  }

  /** Runs the writes of an interactive transaction in order. */
  private async runWrites(writes: PromiseLike<unknown>[]): Promise<void> {
    for (const w of writes) await w;
  }

  /**
   * Reverts every event an undo group wrote, newest first: a created session
   * is removed (soft delete, as a user delete does), a moved one goes back to
   * its previous start. A session moved again since keeps its current start
   * and is listed in `skippedSessionIds`.
   */
  async undo(user: User, groupId: string): Promise<UndoPlacementResponse> {
    const events = await this.prisma.sessionEvent.findMany({
      where: {
        userId: user.id,
        groupId,
        eventType: { in: UNDOABLE_EVENT_TYPES },
        sessionId: { not: null },
      },
      orderBy: { occurredAt: "desc" },
      select: {
        sessionId: true,
        eventType: true,
        oldSnapshot: true,
        newSnapshot: true,
      },
    });
    if (events.length === 0) throw new NotFoundException("Nothing to undo");

    const restored: DisplacedSession[] = [];
    const removedSessionIds: string[] = [];
    const skippedSessionIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const e of events) {
        const id = e.sessionId as string;
        if (e.eventType === SessionEventType.CREATE) {
          const removed = await tx.session.updateMany({
            where: { id, userId: user.id, deleted: false },
            data: { deleted: true },
          });
          if (removed.count) removedSessionIds.push(id);
          else skippedSessionIds.push(id);
          continue;
        }
        const from = (e.oldSnapshot as { scheduledStartTime?: string } | null)
          ?.scheduledStartTime;
        const to = (e.newSnapshot as { scheduledStartTime?: string })
          .scheduledStartTime;
        const row = await tx.session.findFirst({
          where: { id, userId: user.id, deleted: false },
          select: { scheduledStartTime: true },
        });
        if (
          !row?.scheduledStartTime ||
          !from ||
          !to ||
          row.scheduledStartTime.toISOString() !== to
        ) {
          skippedSessionIds.push(id);
          continue;
        }
        await tx.session.update({
          where: { id },
          data: { scheduledStartTime: new Date(from) },
        });
        restored.push({ id, from: to, to: from });
      }
    });
    return {
      undoGroupId: groupId,
      restored,
      removedSessionIds,
      skippedSessionIds,
    };
  }
}
