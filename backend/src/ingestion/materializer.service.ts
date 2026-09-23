import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { fromZonedTime } from "date-fns-tz";
import { DEFAULT_REMINDER_MINUTES } from "@zenflow/shared";
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
  ParsedPortalItem,
} from "./core/types";
import { NotificationsService } from "../notifications/notifications.service";
import {
  ingestionBlocks,
  ingestionReconcileDeleted,
} from "../observability/metrics";
import { NotificationEvent } from "../notifications/types";
import { SyncConflictsService } from "./sync-conflicts.service";

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
  /**
   * New sessions written on their first sighting. It is on the calendar
   * immediately, but `syncConfirmedAt` is left null and no notification is
   * raised yet — see {@link MaterializerService.confirmPending}.
   */
  created: number;
  /**
   * A pending session (first-sighting `created`, above) seen for a second
   * time: its fields are refreshed to the latest upstream data,
   * `syncConfirmedAt` is stamped, and this is where its "new item"
   * notification is finally raised.
   */
  confirmed: number;
  /** Existing, confirmed sessions whose upstream time/title/note/location moved and were rewritten. */
  updated: number;
  /** Already on the calendar, identical — the common case on a re-run. */
  unchanged: number;
  /**
   * The student soft-deleted this item themselves; upstream still lists it,
   * but we leave it alone rather than recreating it.
   */
  skippedDeleted: number;
  /**
   * The student had already moved this item by hand (`lastMovedAt` set);
   * upstream disagrees, but their move wins — silently, no notification.
   */
  skippedMoved: number;
}

/** What one {@link MaterializerService.reconcileDeleted} call did. */
export interface ReconcileOutcome {
  /**
   * Confirmed ingested sessions soft-deleted because upstream dropped them on
   * two consecutive runs in a row (the second consecutive miss).
   */
  deleted: number;
  /**
   * Upstream dropped an item the student had already hand-moved — kept on
   * the calendar (their move wins), silently, no notification.
   */
  keptMoved: number;
  /**
   * A confirmed session missing from upstream for the first time this run —
   * `syncMissedAt` stamped, left exactly as-is on the calendar, no
   * notification. Only a *second* consecutive miss (next run) removes it.
   */
  missedOnce: number;
  /**
   * A still-pending session (never confirmed by a second sighting — see
   * {@link MaterializeOutcome.created}) that vanished before it ever was:
   * hard-deleted outright rather than soft-deleted, since it was never a
   * real, user-facing item. No notification.
   */
  hardDeletedUnconfirmed: number;
}

/** One lecture create/update, held back for the batch's grouped announcement. */
interface LectureChange {
  sessionId: string;
  block: ParsedBlock;
  kind: "created" | "updated";
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
 * 2. **Plain sync, upstream wins — unless the student already moved it.**
 *    Upstream (the university's own record) is authoritative for an ingested
 *    item: a change is applied and raises a `CHANGE` notification, a removal
 *    soft-deletes the row and raises a `DROP` notification. Two exceptions,
 *    both silent (no notification, no reversion — the student's action just
 *    wins): a row the student has themselves moved (`lastMovedAt` set) keeps
 *    their position/duration even when upstream disagrees, and a row the
 *    student has themselves deleted (soft-deleted) is recognized by its
 *    still-unique `externalKey` and left alone forever rather than recreated.
 * 3. **A quiet re-run is quiet.** Notifications are raised only for genuinely
 *    new, changed or removed items, so an unchanged item never produces a
 *    second one.
 * 4. **A term's timetable is one notification, not hundreds.** A lecture
 *    create/update is held back and folded into a single per-term "timetable is
 *    available" row once ten or more lectures are on the calendar for that term
 *    ({@link TIMETABLE_GROUP_THRESHOLD}); smaller additions list the class
 *    names. Assignments and exams stay one notification each — those are
 *    individually actionable.
 * 5. **A single-run blip proves nothing.** A brand-new item is written to the
 *    calendar on first sighting (so it's visible right away) but its
 *    `syncConfirmedAt` stays null and its notification is held back; only a
 *    *second* consecutive sighting confirms it and raises the notification
 *    (see {@link create} / {@link confirmPending}). Symmetrically, a confirmed
 *    item missing from one run is just stamped `syncMissedAt` and left alone;
 *    only a second consecutive miss soft-deletes it (see
 *    {@link reconcileDeleted}). A pending item that vanishes before it is ever
 *    confirmed is hard-deleted outright — it was never a real, user-facing item.
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
    @Optional() private readonly syncConflicts?: SyncConflictsService,
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
    const runStart = new Date();
    const outcome: MaterializeOutcome = {
      created: 0,
      confirmed: 0,
      updated: 0,
      unchanged: 0,
      skippedDeleted: 0,
      skippedMoved: 0,
    };

    // Lecture creates/updates are announced once for the whole batch, not one
    // row per meeting — see rule #4. A first sighting never lands here (its
    // notification is held back until it's confirmed).
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
          deleted: true,
          lastMovedAt: true,
          syncConfirmedAt: true,
          syncMissedAt: true,
        },
      });

      if (existing?.deleted) {
        // The student deleted this item themselves; upstream still lists it,
        // but we honour their deletion instead of recreating it.
        outcome.skippedDeleted += 1;
        continue;
      }

      if (!existing) {
        // First sighting: on the calendar immediately, but `syncConfirmedAt`
        // stays null and no notification is raised yet — that happens on the
        // second sighting, once the item has survived a re-run (see
        // `confirmPending`). A single-run blip must never notify.
        const createdId = await this.create(userId, block, source);
        outcome[createdId ? "created" : "unchanged"] += 1;
        continue;
      }

      if (existing.syncConfirmedAt === null) {
        // Second sighting of a still-pending item: apply the latest fields
        // (upstream may have refined the data between the two sightings),
        // confirm it, and raise its "new item" notification now.
        await this.confirmPending(userId, existing.id, block, now);
        outcome.confirmed += 1;
        if (block.type === "LECTURE") {
          lectureChanges.push({
            sessionId: existing.id,
            block,
            kind: "created",
          });
        }
        continue;
      }

      if (existing.syncMissedAt !== null) {
        // Reappeared after one miss: the miss streak broke. This happens
        // regardless of whether anything else about the row also changed.
        await this.prisma.session.update({
          where: { id: existing.id },
          data: { syncMissedAt: null },
        });
      }

      if (!differsFromUpstream(existing, block)) {
        outcome.unchanged += 1;
        continue;
      }

      if (existing.lastMovedAt) {
        // The student moved this by hand; their move wins over upstream,
        // silently — no notification, no reversion.
        outcome.skippedMoved += 1;
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

    // `unchanged` / total ≈ how much of the run was redundant re-work (the
    // thing a cache on this path would save). `source` is portal|lms.
    for (const [label, n] of Object.entries(outcome)) {
      if (n > 0) ingestionBlocks.add(n, { source, outcome: label });
    }

    await this.notifySyncConflicts(userId, source, blocks, outcome, runStart);

    return outcome;
  }

  /**
   * After a run that wrote/moved fixed blocks, tell the student which of their
   * own tasks now clash (one notification per block type: timetable / exam /
   * LMS — issue #62 D). Best-effort; never fails the sync.
   */
  private async notifySyncConflicts(
    userId: string,
    source: IngestedSource,
    blocks: readonly ParsedBlock[],
    outcome: MaterializeOutcome,
    since: Date,
  ): Promise<void> {
    if (!this.syncConflicts || outcome.created + outcome.updated === 0) return;
    for (const type of new Set(blocks.map((b) => b.type))) {
      try {
        await this.syncConflicts.detectAndNotify({
          userId,
          source,
          type,
          since,
        });
      } catch (err) {
        this.logger.warn(
          `sync-conflict detection failed: ${(err as Error).message}`,
        );
      }
    }
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
   * Naturally idempotent: a soft-deleted row is excluded from the candidate
   * query (`deleted: false`), so a settled re-run finds nothing left to
   * retire.
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
        deleted: false,
        scheduledStartTime: { gte: window.from, lte: window.to },
      },
      select: {
        id: true,
        externalKey: true,
        title: true,
        type: true,
        scheduledStartTime: true,
        lastMovedAt: true,
        syncConfirmedAt: true,
        syncMissedAt: true,
      },
    });

    const gone = candidates.filter(
      (s) => s.externalKey !== null && !seenExternalKeys.has(s.externalKey),
    );
    const empty: ReconcileOutcome = {
      deleted: 0,
      keptMoved: 0,
      missedOnce: 0,
      hardDeletedUnconfirmed: 0,
    };
    if (gone.length === 0) return empty;

    // A pending item (never confirmed by a second sighting) that vanishes
    // before ever being confirmed was never a real, user-facing item — hard
    // delete it outright rather than soft-deleting, no notification.
    const pendingGone = gone.filter((s) => s.syncConfirmedAt === null);
    const confirmedGone = gone.filter((s) => s.syncConfirmedAt !== null);

    const kept = confirmedGone.filter((s) => s.lastMovedAt !== null);
    const eligible = confirmedGone.filter((s) => s.lastMovedAt === null);

    // First miss: stamp `syncMissedAt` and leave the row exactly as-is — no
    // soft-delete, no notification. Only a *second* consecutive miss (the
    // item still missing on the next run, `syncMissedAt` already set) retires it.
    const missedOnce = eligible.filter((s) => s.syncMissedAt === null);
    const removable = eligible.filter((s) => s.syncMissedAt !== null);

    for (const session of pendingGone) {
      await this.prisma.session.delete({ where: { id: session.id } });
    }

    for (const session of missedOnce) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { syncMissedAt: now },
      });
    }

    for (const session of removable) {
      // Soft-delete, mirroring SessionCrudService.remove: the row stays
      // (still-unique externalKey) so a future re-fetch that lists this item
      // again is recognized by `materialize()` and never recreated. No
      // SessionEvent — the student did not do this, so the ML reward trail
      // must not see it — and the FK from Notification is `SetNull`, so the
      // item's old "new class" row simply loses its link rather than
      // vanishing.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { deleted: true },
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

    if (
      removable.length + kept.length + missedOnce.length + pendingGone.length >
      0
    ) {
      this.logger.log(
        `Reconciled ${source} deletions for ${userId}: ` +
          `${removable.length} removed, ${kept.length} kept (hand-moved), ` +
          `${missedOnce.length} missed once, ` +
          `${pendingGone.length} hard-deleted (never confirmed)`,
      );
    }
    if (removable.length > 0) {
      ingestionReconcileDeleted.add(removable.length, { source });
    }

    return {
      deleted: removable.length,
      keptMoved: kept.length,
      missedOnce: missedOnce.length,
      hardDeletedUnconfirmed: pendingGone.length,
    };
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
   * Insert the session on its first sighting. Returns the new session id, or
   * `null` when a concurrent run won the race for the same `externalKey`
   * (`P2002`), which is a no-op, not an error — the item is on the calendar
   * either way.
   *
   * Raises no notification: `syncConfirmedAt` is left null, and the row's
   * "new item" notification is held back until {@link confirmPending} sees it
   * survive a second run — a single-run blip must not notify.
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
          scheduleStudyUnitId: (block as Partial<ParsedPortalItem>)
            .scheduleStudyUnitId,
        });
        newId = row.id;

        // Ingested lectures/assignments/exams get the same default reminder as
        // a task created in the app; `RemindersService` picks it up on its
        // next sweep and arms the timer.
        await tx.sessionReminder.create({
          data: {
            sessionId: row.id,
            remindBeforeMinutes: DEFAULT_REMINDER_MINUTES,
          },
        });
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
   * Upstream changed an item the student has never touched: follow it. The
   * caller only reaches here once `lastMovedAt` has already been checked
   * (rule #2) — a hand-moved row never gets here.
   *
   * No `SessionEvent` is written. The event trail records *user* behaviour and
   * the LinUCB reward signal reads it — a `MOVE` the student did not make would
   * be a fabricated negative signal against whichever slot the scheduler chose.
   * `lastMovedAt` is left untouched for the same reason: it means "the student
   * moved this", and this write is not the student's doing.
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
            title: `Updated: ${block.title}`,
            content:
              "DLU changed this item, so your calendar has been updated to match.",
            eventEndsAt: blockEndsAt(block),
            eventName: this.updatedEventName(block),
          },
          tx,
        );
      }
    });
  }

  /**
   * Second sighting of a still-pending item (`syncConfirmedAt === null`):
   * apply the latest upstream fields — upstream may have refined the data
   * between the two sightings — stamp `syncConfirmedAt`, and only now raise
   * the "new item" notification the caller held back on the first sighting.
   *
   * Like {@link create}, a lecture raises no notification here — the caller
   * folds it into the batch's grouped announcement instead.
   */
  private async confirmPending(
    userId: string,
    sessionId: string,
    block: ParsedBlock,
    now: Date,
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
          syncConfirmedAt: now,
        },
      });
      if (block.type !== "LECTURE") {
        await this.raise(
          userId,
          {
            sessionId,
            title: this.createdTitle(block),
            content: this.createdContent(block),
            eventEndsAt: blockEndsAt(block),
            eventName: this.createdEventName(block),
          },
          tx,
        );
      }
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
      where: { userId, title: groupedTitle },
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

    const allNew = changes.every((c) => c.kind === "created");

    if (termLectureCount >= TIMETABLE_GROUP_THRESHOLD) {
      await this.raise(userId, {
        sessionId: earliest.sessionId,
        title: groupedTitle,
        content:
          `Your ${termLabel(term.semester)} class timetable is on your ` +
          "calendar. Plan study sessions around it.",
        eventName: allNew ? "lecture.group_created" : "lecture.group_updated",
      });
      return;
    }

    await this.raise(userId, {
      sessionId: earliest.sessionId,
      title: `${allNew ? "New" : "Updated"} lectures: ${humanList(
        changes.map((c) => c.block.title),
      )}`,
      content: "Added to your calendar from your DLU timetable.",
      eventName: allNew ? "lecture.created" : "lecture.updated",
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
        title: `Removed from DLU: ${item.title}`,
        content:
          `This ${item.type === "EXAM" ? "exam" : "assignment"} was taken ` +
          "off DLU, so it is no longer on your calendar.",
        materializeSession: false,
        eventName: `${item.type.toLowerCase()}.removed`,
      });
    }

    if (lectures.length === 0) return;

    const term = resolveSemester(now, this.dluTz);
    if (lectures.length >= TIMETABLE_GROUP_THRESHOLD) {
      await this.raise(userId, {
        sessionId: null,
        title: `Your ${termLabel(term.semester)} timetable changed`,
        content:
          `${lectures.length} classes were removed from your ` +
          `${termLabel(term.semester)} timetable.`,
        materializeSession: false,
        eventName: "lecture.group_removed",
      });
      return;
    }

    await this.raise(userId, {
      sessionId: null,
      title: `Lectures removed: ${humanList(lectures.map((l) => l.title))}`,
      content: "These classes were taken off your DLU timetable.",
      materializeSession: false,
      eventName: "lecture.removed",
    });
  }

  /** Write a notification and push it onto the live inbox stream. */
  private async raise(
    userId: string,
    dto: {
      sessionId: string | null;
      title: string;
      content: string;
      eventEndsAt?: Date | null;
      materializeSession?: boolean;
      eventName: string;
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

  /** Slug for a per-item "new item" notification — `<type>.created`. */
  private createdEventName(block: ParsedBlock): string {
    return `${block.type.toLowerCase()}.created`;
  }

  /** Slug for a per-item "changed" notification — `<type>.updated`. */
  private updatedEventName(block: ParsedBlock): string {
    return `${block.type.toLowerCase()}.updated`;
  }
}
