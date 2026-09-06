import { Injectable, Logger } from "@nestjs/common";
import type { NotificationTopic } from "@zenflow/shared";
import { Prisma, type SessionSource } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { insertFixedSession } from "../sessions/fixed-session-writer";
import type { IngestedSessionType, ParsedBlock } from "./core/types";

/** Which DLU system a batch of blocks came from. */
export type IngestedSource = Extract<SessionSource, "LMS" | "PORTAL">;

/** What one {@link MaterializerService.materialize} call did. */
export interface MaterializeOutcome {
  /** New sessions written (each with its notification). */
  created: number;
  /** Existing sessions whose upstream time/title/note moved and were rewritten. */
  updated: number;
  /** Already on the calendar, identical — the common case on a re-run. */
  unchanged: number;
  /**
   * Upstream changed, but the student had already moved the session by hand,
   * so the calendar was left alone and a `TIMETABLE` notification was raised.
   */
  guarded: number;
}

/** Which inbox topic an ingested block belongs under. */
function topicOf(type: IngestedSessionType): NotificationTopic {
  if (type === "ASSIGNMENT") return "ASSIGNMENT";
  if (type === "EXAM") return "EXAM";
  return "TIMETABLE";
}

/**
 * `Session` has no `location` column, and the room is the single most useful
 * thing about a timetable meeting, so it is folded into the note alongside
 * whatever the parser already put there (an exam's format, say).
 */
function noteOf(block: ParsedBlock): string | null {
  const parts = [block.note, block.location ? `Room ${block.location}` : null];
  const joined = parts.filter((p): p is string => !!p).join(" · ");
  return joined.length > 0 ? joined : null;
}

/** The upstream-facing fields a re-run may find changed. */
interface ComparableSession {
  title: string;
  note: string | null;
  durationMinutes: number;
  scheduledStartTime: Date | null;
}

function differsFromUpstream(
  existing: ComparableSession,
  block: ParsedBlock,
): boolean {
  return (
    existing.title !== block.title ||
    existing.note !== noteOf(block) ||
    existing.durationMinutes !== block.durationMinutes ||
    existing.scheduledStartTime?.getTime() !==
      block.scheduledStartTime.getTime()
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === (PostgresErrorCode.UniqueConstraintViolation as string)
  );
}

/**
 * Turns the pure parsers' {@link ParsedBlock}s into calendar rows and inbox
 * entries — the whole of the watchers' write side.
 *
 * Three rules it exists to enforce:
 *
 * 1. **Idempotent on `[userId, externalKey]`.** Every watcher re-fetches the
 *    same window on every tick, so without this the calendar would grow a
 *    duplicate of every assignment every hour. The unique index is the guard;
 *    `P2002` is the race signal for two runs overlapping on the same item.
 * 2. **Never clobber a student's own edit.** If they have moved the session
 *    (`lastMovedAt != null`), an upstream change does not overwrite it — the
 *    row is left exactly as they left it and a `TIMETABLE` notification tells
 *    them the two now disagree.
 * 3. **A quiet re-run is quiet.** Notifications are raised only for genuinely
 *    new or changed items, so an unchanged item never produces a second one.
 *
 * Writes go through {@link insertFixedSession}, the same insert
 * `SessionCrudService` uses, so an ingested row is part of the same
 * `SessionEvent` audit trail as a user-pinned one.
 *
 * Deliberately **not** wrapped in one big transaction: a month can carry dozens
 * of items and `PrismaService` warns that an interactive transaction holds its
 * connection for its whole life. Each item is its own small transaction, which
 * also means one bad row cannot roll back a whole month of good ones.
 */
@Injectable()
export class MaterializerService {
  private readonly logger = new Logger(MaterializerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write `blocks` onto `userId`'s calendar.
   *
   * `source` is a parameter rather than something read off the block because
   * the parsers describe *what* an item is, not which system it came from —
   * the watcher that called them is the one that knows.
   */
  async materialize(
    userId: string,
    blocks: readonly ParsedBlock[],
    source: IngestedSource,
  ): Promise<MaterializeOutcome> {
    const outcome: MaterializeOutcome = {
      created: 0,
      updated: 0,
      unchanged: 0,
      guarded: 0,
    };

    for (const block of blocks) {
      const existing = await this.prisma.session.findUnique({
        where: {
          userId_externalKey: { userId, externalKey: block.externalKey },
        },
        select: {
          id: true,
          title: true,
          note: true,
          durationMinutes: true,
          scheduledStartTime: true,
          lastMovedAt: true,
        },
      });

      if (!existing) {
        if (await this.create(userId, block, source)) outcome.created += 1;
        else outcome.unchanged += 1;
        continue;
      }

      if (!differsFromUpstream(existing, block)) {
        outcome.unchanged += 1;
        continue;
      }

      if (existing.lastMovedAt) {
        await this.warnWithoutClobbering(userId, existing.id, block);
        outcome.guarded += 1;
        continue;
      }

      await this.applyUpstreamChange(userId, existing.id, block);
      outcome.updated += 1;
    }

    return outcome;
  }

  /**
   * Insert the session and its notification together. Returns false when a
   * concurrent run won the race for the same `externalKey` (`P2002`), which is
   * a no-op, not an error — the item is on the calendar either way.
   */
  private async create(
    userId: string,
    block: ParsedBlock,
    source: IngestedSource,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await insertFixedSession(tx, {
          userId,
          type: block.type,
          source,
          title: block.title,
          note: noteOf(block),
          durationMinutes: block.durationMinutes,
          scheduledStartTime: block.scheduledStartTime,
          externalKey: block.externalKey,
        });
        await tx.notification.create({
          data: {
            userId,
            sessionId: row.id,
            topic: topicOf(block.type),
            title: this.createdTitle(block),
            content: this.createdContent(block),
          },
        });
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.debug(
          `Concurrent run already wrote ${block.externalKey}; skipping`,
        );
        return false;
      }
      throw error;
    }
  }

  /**
   * Upstream moved an item the student has never touched: follow it.
   *
   * No `SessionEvent` is written. The event trail records *user* behaviour and
   * the LinUCB reward signal reads it — a `MOVE` the student did not make would
   * be a fabricated negative signal against whichever slot the scheduler chose.
   * `lastMovedAt` is left null for the same reason: it means "the student moved
   * this", and they did not.
   */
  private async applyUpstreamChange(
    userId: string,
    sessionId: string,
    block: ParsedBlock,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: sessionId },
        data: {
          title: block.title,
          note: noteOf(block),
          durationMinutes: block.durationMinutes,
          scheduledStartTime: block.scheduledStartTime,
        },
      });
      await tx.notification.create({
        data: {
          userId,
          sessionId,
          topic: topicOf(block.type),
          title: `Updated: ${block.title}`,
          content:
            "DLU changed this item, so your calendar has been updated to match.",
        },
      });
    });
  }

  /**
   * The don't-clobber path (#30's open question, resolved in the student's
   * favour): tell them, change nothing.
   *
   * Deduplicated on the exact `content` — which embeds the upstream instant —
   * because unlike the update path this disagreement never resolves itself, so
   * a naive raise would mint an identical notification on every cron tick.
   * Encoding the instant keeps a *further* upstream move loud while keeping the
   * same one quiet.
   */
  private async warnWithoutClobbering(
    userId: string,
    sessionId: string,
    block: ParsedBlock,
  ): Promise<void> {
    const content =
      `DLU moved this to ${block.scheduledStartTime.toISOString()}, but you had ` +
      `already rescheduled it yourself, so your version was kept.`;

    const already = await this.prisma.notification.findFirst({
      where: { userId, sessionId, topic: "TIMETABLE", content },
      select: { id: true },
    });
    if (already) return;

    await this.prisma.notification.create({
      data: {
        userId,
        sessionId,
        topic: "TIMETABLE",
        title: `${block.title} moved at DLU`,
        content,
      },
    });
  }

  private createdTitle(block: ParsedBlock): string {
    if (block.type === "ASSIGNMENT") return `New assignment: ${block.title}`;
    if (block.type === "EXAM") return `New exam: ${block.title}`;
    return `New class: ${block.title}`;
  }

  private createdContent(block: ParsedBlock): string {
    if (block.type === "ASSIGNMENT") {
      return "Added to your calendar from DLU. Plan the work that leads up to it.";
    }
    if (block.type === "EXAM") {
      return "Added to your calendar from DLU. Plan revision sessions before it.";
    }
    return "Added to your calendar from your DLU timetable.";
  }
}
