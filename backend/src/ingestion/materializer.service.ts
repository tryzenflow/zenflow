import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fromZonedTime } from "date-fns-tz";
import type { NotificationKind, NotificationTopic } from "@zenflow/shared";
import {
  Prisma,
  type Notification,
  type SessionSource,
} from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { insertFixedSession } from "../sessions/fixed-session-writer";
import { TagsService } from "../tags/tags.service";
import { monthsFrom, resolveSemester, type TermId } from "./core/semester";
import type {
  IngestedSessionType,
  ParsedBlock,
  ParsedLmsItem,
} from "./core/types";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";

/** Which DLU system a batch of blocks came from. */
export type IngestedSource = Extract<SessionSource, "LMS" | "PORTAL">;

/**
 * A batch of lecture creates/updates this size or larger collapses to a single
 * "the term's timetable is on your calendar" notification instead of one row
 * per meeting. A whole term is hundreds of meetings; a handful of new classes
 * mid-term is worth listing by name.
 */
const TIMETABLE_GROUP_THRESHOLD = 10;

/**
 * How many calendar months forward an LMS run covers — kept in step with
 * `MONTHS_PER_RUN` in `lms-watcher.service.ts`. Only used to bound the deletion
 * reconciliation window so a re-run that no longer sees an item can retire it.
 */
const LMS_RECONCILE_MONTHS = 2;

/** What one {@link MaterializerService.materialize} call did. */
export interface MaterializeOutcome {
  /** New sessions written (each with its notification). */
  created: number;
  /** Existing sessions whose upstream time/title/note/location moved and were rewritten. */
  updated: number;
  /** Already on the calendar, identical — the common case on a re-run. */
  unchanged: number;
  /**
   * Upstream changed, but the student had already moved the session by hand,
   * so the calendar was left alone and a `TIMETABLE` notification was raised.
   */
  guarded: number;
}

/** What one {@link MaterializerService.reconcileDeleted} call did. */
export interface ReconcileOutcome {
  /** Ingested sessions removed because upstream dropped them. */
  deleted: number;
  /**
   * Ingested sessions upstream dropped that the student had already hand-moved
   * — kept on the calendar, with a one-off warning instead of a deletion.
   */
  keptWithWarning: number;
}

/** One lecture create/update, held back for the batch's grouped announcement. */
interface LectureChange {
  sessionId: string;
  block: ParsedBlock;
  kind: "created" | "updated";
}

/** Which inbox topic an ingested block belongs under. */
function topicOf(type: IngestedSessionType): NotificationTopic {
  if (type === "ASSIGNMENT") return "ASSIGNMENT";
  if (type === "EXAM") return "EXAM";
  return "TIMETABLE";
}

/**
 * Tag names to hang on the session. Today that is the LMS course's full name
 * (portal timetable blocks carry their section metadata in `note`/`location`
 * instead) — an empty list for anything without one.
 */
function tagNamesOf(block: ParsedBlock): string[] {
  const course = (block as Partial<ParsedLmsItem>).lmsCourse;
  return course ? [course.fullName] : [];
}

/**
 * "A, B, C" for up to three names, "A, B, C +2 more" beyond that. Titles are
 * de-duplicated first: a week of one class is several meetings sharing a title.
 */
function humanList(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} +${unique.length - 3} more`;
}

/** The fixed end instant of a block — its start plus its duration. */
function blockEndsAt(block: ParsedBlock): Date {
  return new Date(
    block.scheduledStartTime.getTime() + block.durationMinutes * 60_000,
  );
}

/** DLU term id → the friendly "semester N" the inbox shows instead of "HK0N". */
function termLabel(semester: TermId): string {
  return `semester ${semester === "HK01" ? 1 : semester === "HK02" ? 2 : 3}`;
}

/** The upstream-facing fields a re-run may find changed. */
interface ComparableSession {
  title: string;
  note: string | null;
  location: string | null;
  durationMinutes: number;
  scheduledStartTime: Date | null;
}

function differsFromUpstream(
  existing: ComparableSession,
  block: ParsedBlock,
): boolean {
  return (
    existing.title !== block.title ||
    existing.note !== block.note ||
    existing.location !== block.location ||
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
 * Four rules it exists to enforce:
 *
 * 1. **Idempotent on `[userId, externalKey]`.** Every watcher re-fetches the
 *    same window on every tick, so without this the calendar would grow a
 *    duplicate of every assignment every hour. The unique index is the guard;
 *    `P2002` is the race signal for two runs overlapping on the same item.
 * 2. **Never clobber a student's own edit.** If they have moved the session
 *    (`lastMovedAt != null`), an upstream change does not overwrite it — the
 *    row is left exactly as they left it and a `TIMETABLE` notification tells
 *    them the two now disagree. The same holds if upstream *deletes* an item
 *    they had moved: {@link reconcileDeleted} keeps the row and warns.
 * 3. **A quiet re-run is quiet.** Notifications are raised only for genuinely
 *    new, changed or removed items, so an unchanged item never produces a
 *    second one.
 * 4. **A term's timetable is one notification, not hundreds.** A lecture
 *    create/update is held back and folded into a single per-term "timetable is
 *    available" row once ten or more lectures are on the calendar for that term
 *    ({@link TIMETABLE_GROUP_THRESHOLD}); smaller additions list the class
 *    names. Assignments and exams stay one notification each — those are
 *    individually actionable.
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
  private readonly dluTz: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.dluTz = config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
  }

  /**
   * Write `blocks` onto `userId`'s calendar.
   *
   * `source` is a parameter rather than something read off the block because
   * the parsers describe *what* an item is, not which system it came from —
   * the watcher that called them is the one that knows. `now` is threaded in
   * for the same reason it is everywhere in ingestion: the academic term a
   * lecture batch belongs to is resolved against it, and the server clock is
   * not the university's.
   */
  async materialize(
    userId: string,
    blocks: readonly ParsedBlock[],
    source: IngestedSource,
    now: Date = new Date(),
  ): Promise<MaterializeOutcome> {
    const outcome: MaterializeOutcome = {
      created: 0,
      updated: 0,
      unchanged: 0,
      guarded: 0,
    };

    // Lecture creates/updates are announced once for the whole batch, not one
    // row per meeting — see rule #4.
    const lectureChanges: LectureChange[] = [];

    for (const block of blocks) {
      const existing = await this.prisma.session.findUnique({
        where: {
          userId_externalKey: { userId, externalKey: block.externalKey },
        },
        select: {
          id: true,
          title: true,
          note: true,
          location: true,
          durationMinutes: true,
          scheduledStartTime: true,
          lastMovedAt: true,
        },
      });

      if (!existing) {
        const createdId = await this.create(userId, block, source);
        if (createdId) {
          outcome.created += 1;
          if (block.type === "LECTURE") {
            lectureChanges.push({
              sessionId: createdId,
              block,
              kind: "created",
            });
          }
        } else {
          outcome.unchanged += 1;
        }
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
      if (block.type === "LECTURE") {
        lectureChanges.push({
          sessionId: existing.id,
          block,
          kind: "updated",
        });
      }
    }

    if (lectureChanges.length > 0) {
      await this.announceLectureChanges(userId, source, lectureChanges, now);
    }

    return outcome;
  }

  /**
   * Retire ingested sessions upstream no longer lists.
   *
   * The watcher accumulates every `externalKey` it saw across its whole run
   * (all months / all weeks) and hands them here; any ingested `(source, type)`
   * session that starts inside the run's forward window but is *not* in that
   * set is one upstream has dropped — a cancelled lecture, a withdrawn exam, a
   * deleted assignment. The window is bounded (term end for the portal, the
   * last fetched month for the LMS) so a past session is never touched and a
   * gap in one run cannot delete next month's rows.
   *
   * Naturally idempotent: a deleted row is gone from both the calendar and the
   * next fetch, so a settled re-run finds nothing. A session the student had
   * hand-moved is the one exception — it is kept (rule #2) with a single
   * deduplicated warning.
   *
   * The caller must skip this entirely when any fetch in the run failed: a
   * missing week would otherwise read as "every class that week was cancelled".
   */
  async reconcileDeleted(
    userId: string,
    source: IngestedSource,
    types: readonly IngestedSessionType[],
    seenExternalKeys: ReadonlySet<string>,
    now: Date = new Date(),
  ): Promise<ReconcileOutcome> {
    const window = this.reconcileWindow(source, now);

    const candidates = await this.prisma.session.findMany({
      where: {
        userId,
        source,
        type: { in: [...types] },
        externalKey: { not: null },
        scheduledStartTime: { gte: window.from, lte: window.to },
      },
      select: {
        id: true,
        externalKey: true,
        title: true,
        type: true,
        lastMovedAt: true,
        scheduledStartTime: true,
      },
    });

    const gone = candidates.filter(
      (s) => s.externalKey !== null && !seenExternalKeys.has(s.externalKey),
    );
    if (gone.length === 0) return { deleted: 0, keptWithWarning: 0 };

    const kept = gone.filter((s) => s.lastMovedAt !== null);
    const removable = gone.filter((s) => s.lastMovedAt === null);

    for (const session of kept) {
      await this.warnRemovedButKept(userId, session.id, session.title);
    }

    for (const session of removable) {
      // Mirrors SessionCrudService.remove: a plain delete. No SessionEvent —
      // the student did not do this, so the ML reward trail must not see it —
      // and the FK from Notification is `SetNull`, so the item's old "new
      // class" row simply loses its link rather than vanishing.
      await this.prisma.$transaction(async (tx) => {
        await tx.session.delete({ where: { id: session.id } });
      });
    }

    await this.announceRemovals(
      userId,
      removable.map((s) => ({
        title: s.title,
        // Narrowed by the `type: { in: types }` filter on the query above.
        type: s.type as IngestedSessionType,
      })),
      now,
    );

    if (removable.length + kept.length > 0) {
      this.logger.log(
        `Reconciled ${source} deletions for ${userId}: ` +
          `${removable.length} removed, ${kept.length} kept as edited`,
      );
    }

    return { deleted: removable.length, keptWithWarning: kept.length };
  }

  /** The forward span a run of `source` covers — its deletion horizon. */
  private reconcileWindow(
    source: IngestedSource,
    now: Date,
  ): { from: Date; to: Date } {
    if (source === "PORTAL") {
      // Timetable and exam runs are both addressed by academic term.
      return { from: now, to: resolveSemester(now, this.dluTz).endDate };
    }
    // LMS: the last instant of the last calendar month the run fetched.
    const months = monthsFrom(now, this.dluTz, LMS_RECONCILE_MONTHS);
    const last = months[months.length - 1];
    const followingMonthStart = fromZonedTime(
      `${last.month === 12 ? last.year + 1 : last.year}-` +
        `${String(last.month === 12 ? 1 : last.month + 1).padStart(2, "0")}-` +
        `01T00:00:00.000`,
      this.dluTz,
    );
    return { from: now, to: new Date(followingMonthStart.getTime() - 1) };
  }

  /**
   * Insert the session. Returns the new session id, or `null` when a
   * concurrent run won the race for the same `externalKey` (`P2002`), which is
   * a no-op, not an error — the item is on the calendar either way.
   *
   * Assignment/exam creates raise their own notification inside the same
   * transaction; a lecture create does not — the caller folds it into the
   * batch's grouped announcement.
   */
  private async create(
    userId: string,
    block: ParsedBlock,
    source: IngestedSource,
  ): Promise<string | null> {
    try {
      let newId: string | null = null;
      await this.prisma.$transaction(async (tx) => {
        const tagIds = await this.tagsService.resolveTagIds(
          tx,
          userId,
          tagNamesOf(block),
        );
        const row = await insertFixedSession(tx, {
          userId,
          type: block.type,
          source,
          title: block.title,
          note: block.note,
          location: block.location,
          durationMinutes: block.durationMinutes,
          scheduledStartTime: block.scheduledStartTime,
          tagIds,
          externalKey: block.externalKey,
        });
        newId = row.id;

        if (block.type !== "LECTURE") {
          await this.raise(
            userId,
            {
              sessionId: row.id,
              topic: topicOf(block.type),
              kind: "NEW",
              title: this.createdTitle(block),
              content: this.createdContent(block),
              eventEndsAt: blockEndsAt(block),
            },
            tx,
          );
        }
      });
      return newId;
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.debug(
          `Concurrent run already wrote ${block.externalKey}; skipping`,
        );
        return null;
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
   *
   * A lecture change raises no notification here — the caller folds it into the
   * batch's grouped announcement.
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
          note: block.note,
          location: block.location,
          durationMinutes: block.durationMinutes,
          scheduledStartTime: block.scheduledStartTime,
        },
      });
      if (block.type !== "LECTURE") {
        await this.raise(
          userId,
          {
            sessionId,
            topic: topicOf(block.type),
            kind: "CHANGE",
            title: `Updated: ${block.title}`,
            content:
              "DLU changed this item, so your calendar has been updated to match.",
            eventEndsAt: blockEndsAt(block),
          },
          tx,
        );
      }
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

    await this.raise(userId, {
      sessionId,
      topic: "TIMETABLE",
      kind: "CHANGE",
      title: `${block.title} moved at DLU`,
      content,
    });
  }

  /**
   * Upstream dropped an item the student had already hand-moved. Rule #2 says
   * keep their row; this tells them the two now disagree. Deduplicated on the
   * fixed content, because — like {@link warnWithoutClobbering} — the
   * disagreement is permanent and would otherwise re-raise every run.
   */
  private async warnRemovedButKept(
    userId: string,
    sessionId: string,
    title: string,
  ): Promise<void> {
    const content =
      "DLU removed this from your schedule, but you had already edited it, " +
      "so your copy was kept on the calendar.";

    const already = await this.prisma.notification.findFirst({
      where: { userId, sessionId, topic: "TIMETABLE", content },
      select: { id: true },
    });
    if (already) return;

    await this.raise(userId, {
      sessionId,
      topic: "TIMETABLE",
      kind: "DROP",
      title: `${title} removed at DLU`,
      content,
    });
  }

  /**
   * One notification for a batch of lecture creates/updates (rule #4).
   *
   * Once ten or more lectures are on the calendar for the term, this is the
   * single "Timetable for semester x is available" row — raised once and then
   * deduplicated on its title, so the ~20 weekly batches of a term's first
   * sync do not each mint one. Below that it lists the class names, so a
   * handful of mid-term additions still say what they are. The `sessionId`
   * points at the earliest changed lecture, for the calendar to land on.
   */
  private async announceLectureChanges(
    userId: string,
    source: IngestedSource,
    changes: readonly LectureChange[],
    now: Date,
  ): Promise<void> {
    const term = resolveSemester(now, this.dluTz);
    const groupedTitle = `Timetable for ${termLabel(term.semester)} is available`;

    const earliest = [...changes].sort(
      (a, b) =>
        a.block.scheduledStartTime.getTime() -
        b.block.scheduledStartTime.getTime(),
    )[0];

    const alreadyAnnounced = await this.prisma.notification.findFirst({
      where: { userId, topic: "TIMETABLE", title: groupedTitle },
      select: { id: true },
    });
    if (alreadyAnnounced) return;

    const termLectureCount = await this.prisma.session.count({
      where: {
        userId,
        source,
        type: "LECTURE",
        scheduledStartTime: { gte: term.startDate, lte: term.endDate },
      },
    });

    if (termLectureCount >= TIMETABLE_GROUP_THRESHOLD) {
      await this.raise(userId, {
        sessionId: earliest.sessionId,
        topic: "TIMETABLE",
        kind: "NEW",
        title: groupedTitle,
        content:
          `Your ${termLabel(term.semester)} class timetable is on your ` +
          "calendar. Plan study sessions around it.",
      });
      return;
    }

    const allNew = changes.every((c) => c.kind === "created");
    await this.raise(userId, {
      sessionId: earliest.sessionId,
      topic: "TIMETABLE",
      kind: allNew ? "NEW" : "CHANGE",
      title: `${allNew ? "New" : "Updated"} lectures: ${humanList(
        changes.map((c) => c.block.title),
      )}`,
      content: "Added to your calendar from your DLU timetable.",
    });
  }

  /**
   * Notifications for a batch of upstream deletions. Lectures collapse the same
   * way creates do — one "timetable updated" row past the threshold, a named
   * list below it — while each removed assignment or exam gets its own row,
   * since losing one of those is individually worth knowing. None carry a
   * `sessionId`: the session is gone.
   */
  private async announceRemovals(
    userId: string,
    removed: readonly { title: string; type: IngestedSessionType }[],
    now: Date,
  ): Promise<void> {
    if (removed.length === 0) return;

    const lectures = removed.filter((r) => r.type === "LECTURE");
    const others = removed.filter((r) => r.type !== "LECTURE");

    for (const item of others) {
      await this.raise(userId, {
        sessionId: null,
        topic: topicOf(item.type),
        kind: "DROP",
        title: `Removed from DLU: ${item.title}`,
        content:
          `This ${item.type === "EXAM" ? "exam" : "assignment"} was taken ` +
          "off DLU, so it is no longer on your calendar.",
      });
    }

    if (lectures.length === 0) return;

    const term = resolveSemester(now, this.dluTz);
    if (lectures.length >= TIMETABLE_GROUP_THRESHOLD) {
      await this.raise(userId, {
        sessionId: null,
        topic: "TIMETABLE",
        kind: "DROP",
        title: `Your ${termLabel(term.semester)} timetable changed`,
        content:
          `${lectures.length} classes were removed from your ` +
          `${termLabel(term.semester)} timetable.`,
      });
      return;
    }

    await this.raise(userId, {
      sessionId: null,
      topic: "TIMETABLE",
      kind: "DROP",
      title: `Lectures removed: ${humanList(lectures.map((l) => l.title))}`,
      content: "These classes were taken off your DLU timetable.",
    });
  }

  /** Write a notification and push it onto the live inbox stream. */
  private async raise(
    userId: string,
    dto: {
      sessionId: string | null;
      topic: NotificationTopic;
      kind: NotificationKind;
      title: string;
      content: string;
      eventEndsAt?: Date | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const row = await this.notifications.create(
      userId,
      { eventEndsAt: null, ...dto },
      tx,
    );
    this.notifications.notify(NotificationEvent.NEW_SESSION, row);
    return row;
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
