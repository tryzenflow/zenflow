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
import { monthsFrom, resolveSemester } from "./core/semester";
import { digestNotifications, SyncDigest } from "./core/sync-digest";
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
 * How many calendar months forward an LMS run covers — kept in step with
 * `MONTHS_PER_RUN` in `lms-watcher.service.ts`. Only used to bound the deletion
 * reconciliation window so a re-run that no longer sees an item can retire it.
 */
const LMS_RECONCILE_MONTHS = 2;

/** What one {@link MaterializerService.materialize} call did. */
export interface MaterializeOutcome {
  created: number;
  /** Upstream time/title/note/location changed — rewritten. */
  updated: number;
  unchanged: number;
  /** Deleted by the student; not recreated. */
  skippedDeleted: number;
  /** Moved by the student (`lastMovedAt`); their move wins. */
  skippedMoved: number;
}

/** What one {@link MaterializerService.reconcileDeleted} call did. */
export interface ReconcileOutcome {
  /** Soft-deleted because a fetch no longer lists them. */
  deleted: number;
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

/** A created/updated block as a digest entry. */
function digestItemOf(
  block: ParsedBlock,
  kind: "created" | "updated",
  sessionId: string,
) {
  return {
    type: block.type,
    kind,
    sessionId,
    title: block.title,
    startsAt: block.scheduledStartTime,
    endsAt: blockEndsAt(block),
  };
}

/** The fixed end instant of a block — its start plus its duration. */
function blockEndsAt(block: ParsedBlock): Date {
  return new Date(
    block.scheduledStartTime.getTime() + block.durationMinutes * 60_000,
  );
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

/**
 * The projection both `externalKey` lookups use.
 *
 * One const rather than two literals so the legacy lookup and the primary
 * lookup can never drift into selecting different fields — the legacy hit falls
 * straight into the same diff path, so it needs exactly the same shape.
 */
const EXISTING_SESSION_SELECT = {
  id: true,
  title: true,
  note: true,
  location: true,
  durationMinutes: true,
  scheduledStartTime: true,
  deleted: true,
  lastMovedAt: true,
} as const;

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
 * Rules:
 *
 * 1. **Idempotent on `[userId, externalKey]`** — `P2002` means a concurrent run.
 * 2. **One fetch is truth.** New items are written on first sighting, changes
 *    applied on the next differing fetch, dropped items soft-deleted on the
 *    first fetch that omits them (soft, so a re-listing isn't recreated).
 * 3. **Upstream wins**, except: a student-moved row (`lastMovedAt`) keeps its
 *    time (but is still removed if upstream drops it), and a student-deleted
 *    row is never recreated.
 * 4. **A quiet re-run is quiet** — only new/changed/removed items notify.
 * 5. **One notification per item type per run** via {@link SyncDigest}.
 *
 * Each item is its own small transaction, so one bad row can't roll back the rest.
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
   * Write `blocks` onto `userId`'s calendar. Pass the watcher's run-wide
   * `digest` to defer notifications; without one it is flushed here.
   */
  async materialize(
    userId: string,
    blocks: readonly ParsedBlock[],
    source: IngestedSource,
    now: Date = new Date(),
    digest?: SyncDigest,
  ): Promise<MaterializeOutcome> {
    const runDigest = digest ?? new SyncDigest(new Date());
    const outcome: MaterializeOutcome = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedDeleted: 0,
      skippedMoved: 0,
    };

    for (const block of blocks) {
      let existing = await this.prisma.session.findUnique({
        where: {
          userId_externalKey: { userId, externalKey: block.externalKey },
        },
        select: EXISTING_SESSION_SELECT,
      });

      // A miss might only mean the row predates the issue-#56 lecture re-key.
      // Adopt it under its new name before deciding anything else — see
      // `adoptLegacyKey`.
      if (!existing) {
        existing = await this.adoptLegacyKey(userId, block);
      }

      if (existing?.deleted) {
        outcome.skippedDeleted += 1;
        continue;
      }

      if (!existing) {
        const createdId = await this.create(userId, block, source);
        outcome[createdId ? "created" : "unchanged"] += 1;
        if (createdId) {
          runDigest.add(digestItemOf(block, "created", createdId), source);
        }
        continue;
      }

      if (!differsFromUpstream(existing, block)) {
        outcome.unchanged += 1;
        continue;
      }

      if (existing.lastMovedAt) {
        outcome.skippedMoved += 1;
        continue;
      }

      await this.applyUpstreamChange(existing.id, block);
      outcome.updated += 1;
      runDigest.add(digestItemOf(block, "updated", existing.id), source);
    }

    if (!digest) await this.flushDigest(userId, runDigest, now);

    // `unchanged` / total ≈ how much of the run was redundant re-work (the
    // thing a cache on this path would save). `source` is portal|lms.
    for (const [label, n] of Object.entries(outcome)) {
      if (n > 0) ingestionBlocks.add(n, { source, outcome: label });
    }

    return outcome;
  }

  /**
   * Soft-delete ingested sessions in the run's forward window whose
   * `externalKey` is not in `seenExternalKeys`. Callers must skip this when
   * any fetch in the run failed.
   */
  async reconcileDeleted(
    userId: string,
    source: IngestedSource,
    types: readonly IngestedSessionType[],
    seenExternalKeys: ReadonlySet<string>,
    now: Date = new Date(),
    digest?: SyncDigest,
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
      },
    });

    const gone = candidates.filter(
      (s) => s.externalKey !== null && !seenExternalKeys.has(s.externalKey),
    );
    const empty: ReconcileOutcome = { deleted: 0 };
    if (gone.length === 0) return empty;

    const removable = gone;

    for (const session of removable) {
      // No SessionEvent: not a user action, so it stays out of the reward trail.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { deleted: true },
      });
    }

    const runDigest = digest ?? new SyncDigest(new Date());
    for (const s of removable) {
      runDigest.add(
        {
          // Narrowed by the `type: { in: types }` filter on the query above.
          type: s.type as IngestedSessionType,
          kind: "removed",
          sessionId: null,
          title: s.title,
          startsAt: null,
          endsAt: null,
        },
        source,
      );
    }
    if (!digest) await this.flushDigest(userId, runDigest, now);

    if (removable.length > 0) {
      this.logger.log(
        `Reconciled ${source} deletions for ${userId}: ${removable.length} removed`,
      );
      ingestionReconcileDeleted.add(removable.length, { source });
    }

    return { deleted: removable.length };
  }

  /**
   * Soft-delete the named ingested sessions.
   *
   * The fan-out sibling of {@link reconcileDeleted}: same rules — no
   * `SessionEvent` (not a user action, so it stays out of the reward trail), a
   * `removed` digest entry, and it only ever touches rows this `source`
   * ingested — but driven by an explicit key list instead of by "everything in
   * the window this run did not see".
   *
   * It needs to exist because a fan-out has no seen-set to reason from. The
   * occurrence cache knows precisely which activities a complete re-read stopped
   * listing; it does not know, and must not assume, anything about the rest of a
   * given student's window. Calling `reconcileDeleted` here would retire every
   * ingested row of that type outside the fanned-out set.
   */
  async retireExternalKeys(
    userId: string,
    source: IngestedSource,
    keys: readonly string[],
    now: Date = new Date(),
    digest?: SyncDigest,
  ): Promise<ReconcileOutcome> {
    if (keys.length === 0) return { deleted: 0 };

    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        source,
        externalKey: { in: [...keys] },
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        type: true,
      },
    });
    if (rows.length === 0) return { deleted: 0 };

    for (const row of rows) {
      // Upstream cancelled the activity, so it goes even if the student had
      // moved it — matching `reconcileDeleted`, which also removes a moved row
      // whose upstream item disappeared.
      await this.prisma.session.update({
        where: { id: row.id },
        data: { deleted: true },
      });
    }

    const runDigest = digest ?? new SyncDigest(new Date());
    for (const row of rows) {
      runDigest.add(
        {
          type: row.type as IngestedSessionType,
          kind: "removed",
          sessionId: null,
          title: row.title,
          startsAt: null,
          endsAt: null,
        },
        source,
      );
    }
    if (!digest) await this.flushDigest(userId, runDigest, now);

    ingestionReconcileDeleted.add(rows.length, { source });
    return { deleted: rows.length };
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
   * Insert the session. Returns its id, or `null` when a concurrent run
   * already wrote the same `externalKey`.
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

        // Same default reminder as an in-app task.
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
   * Rename a pre-#56 lecture row onto its new `externalKey`, returning the row
   * so the caller can carry on as if the lookup had hit.
   *
   * Issue #56 re-keyed portal lectures from the per-student
   * `portal:meeting:<WeekScheduleID>` to the section-scoped
   * `portal:lecture:<section>:<date>:<period>` (see `core/external-key.ts`).
   * Without this step the first run after deploy would, for every lecture on
   * every calendar: miss on the new key, insert a duplicate, and then have
   * `reconcileDeleted` soft-delete the original because its old key is not in
   * the run's `seenKeys`. That would discard each row's `lastMovedAt` (the
   * student's own move), orphan the `Notification.sessionId` and
   * `SessionReminder.sessionId` rows pointing at it, and announce every
   * student's entire timetable as cancelled and re-created.
   *
   * Renaming in place instead keeps the row id, its tags and its reminders, and
   * raises nothing: the row then goes through the ordinary diff, so it is
   * reported `unchanged` unless the payload genuinely differs too. A
   * soft-deleted legacy row is renamed as well, so "the student deleted this
   * class" keeps holding.
   *
   * Returns `null` when there is nothing to adopt — no alias on the block (an
   * exam, an LMS item, or a timetable row with no `WeekScheduleID`), or no row
   * stored under the old name.
   */
  private async adoptLegacyKey(
    userId: string,
    block: ParsedBlock,
  ): Promise<{
    id: string;
    title: string;
    note: string | null;
    location: string | null;
    durationMinutes: number;
    scheduledStartTime: Date | null;
    deleted: boolean;
    lastMovedAt: Date | null;
  } | null> {
    const legacyKey = (block as Partial<ParsedPortalItem>).legacyExternalKey;
    if (!legacyKey) return null;

    const legacy = await this.prisma.session.findUnique({
      where: { userId_externalKey: { userId, externalKey: legacyKey } },
      select: EXISTING_SESSION_SELECT,
    });
    if (!legacy) return null;

    try {
      await this.prisma.session.update({
        where: { id: legacy.id },
        data: { externalKey: block.externalKey },
      });
    } catch (error) {
      // Two legacy rows mapping onto one new key — only reachable from
      // pre-existing duplicate data. Leave the loser on its old key and let
      // `reconcileDeleted` retire it; adopting neither is safer than guessing.
      if (isUniqueViolation(error)) {
        this.logger.debug(
          `Could not adopt ${legacyKey} as ${block.externalKey}: key already taken`,
        );
        return null;
      }
      throw error;
    }

    this.logger.debug(`Adopted ${legacyKey} as ${block.externalKey}`);
    return legacy;
  }

  /**
   * Follow an upstream change. No `SessionEvent` and no `lastMovedAt`: not
   * the student's move, so it must not feed the LinUCB reward.
   */
  private async applyUpstreamChange(
    sessionId: string,
    block: ParsedBlock,
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        title: block.title,
        note: block.note,
        location: block.location,
        durationMinutes: block.durationMinutes,
        scheduledStartTime: block.scheduledStartTime,
      },
    });
  }

  /**
   * Raise the digest's notifications (at most one per item type), then run
   * one sync-conflict check per (source, type) written. Empties the digest.
   */
  async flushDigest(
    userId: string,
    digest: SyncDigest,
    now: Date = new Date(),
  ): Promise<void> {
    const checks = digest.conflictChecks();
    for (const dto of digestNotifications(digest.drain(), now)) {
      await this.raise(userId, dto);
    }
    if (!this.syncConflicts) return;
    for (const { source, type } of checks) {
      // Best-effort: a failed clash check never fails the sync.
      try {
        await this.syncConflicts.detectAndNotify({
          userId,
          source,
          type,
          since: digest.startedAt,
        });
      } catch (err) {
        this.logger.warn(
          `sync-conflict detection failed: ${(err as Error).message}`,
        );
      }
    }
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
}
