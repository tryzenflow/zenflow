import type {
  Prisma,
  SessionSource,
  SessionType,
} from "../../generated/prisma";
import { WITH_TAGS_AND_SERIES, type SessionRow } from "./types/session-row";
import { createEventData } from "./session-events";

/**
 * The one place a **fixed** (already-scheduled, never placed by the engine)
 * `Session` row is inserted.
 *
 * Two callers, one insert:
 *  - `SessionCrudService.createFixedOneOff` — a student pinning an
 *    `ASSIGNMENT` / `EXAM` / `LECTURE` / non-recurring `DND` themselves.
 *  - `ingestion/materializer.service.ts` — the DLU watchers mirroring an
 *    upstream item onto the calendar.
 *
 * The watchers cannot reuse the HTTP path: `CreateSessionDto` has no `source`
 * field and sits behind `forbidNonWhitelisted`, so an ingested row would come
 * out as `source: "USER"` (or be rejected outright). Duplicating the insert
 * instead is how `source`, `externalKey` and — most easily missed — the `CREATE`
 * `SessionEvent` drift apart between the two paths; every ingested session is
 * part of the same audit trail the ML work reads, so it needs that event too.
 *
 * Takes a `Prisma.TransactionClient` rather than `PrismaService`: both callers
 * already own a transaction (the row and its event must land together), and
 * the caller decides how small that transaction is.
 */
export interface FixedSessionInput {
  userId: string;
  /** Never `TASK` — a task is placed by the scheduler, not pinned. */
  type: Exclude<SessionType, "TASK">;
  source: SessionSource;
  title: string;
  note?: string | null;
  /** Positive multiple of 15 (invariant #3). */
  durationMinutes: number;
  /** Where the block sits; fixed sessions are always scheduled. */
  scheduledStartTime: Date;
  /** Upstream identity for ingested rows; null/absent for user-created ones. */
  externalKey?: string | null;
  /** Parent `SessionSeries` for a recurring fixed session. */
  seriesId?: string | null;
  tagIds?: readonly string[];
}

/**
 * Insert the session and its `CREATE` `SessionEvent` inside `tx`, returning the
 * row with tags + series loaded (a {@link SessionRow}, ready for
 * `toSessionDto`).
 */
export async function insertFixedSession(
  tx: Prisma.TransactionClient,
  input: FixedSessionInput,
): Promise<SessionRow> {
  const row = await tx.session.create({
    data: {
      type: input.type,
      source: input.source,
      title: input.title,
      note: input.note ?? null,
      durationMinutes: input.durationMinutes,
      // Fixed types are pinned in time, so they carry no EDF ordering key.
      deadline: null,
      scheduledStartTime: input.scheduledStartTime,
      externalKey: input.externalKey ?? null,
      seriesId: input.seriesId ?? null,
      tags: { connect: (input.tagIds ?? []).map((id) => ({ id })) },
      userId: input.userId,
    },
    include: WITH_TAGS_AND_SERIES,
  });
  await tx.sessionEvent.create({ data: createEventData(row, input.userId) });
  return row;
}
