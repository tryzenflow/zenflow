/**
 * Shapes the pure DLU ingestion parsers produce.
 *
 * These are **internal** to the backend — they are not part of the FE/BE
 * contract in `@zenflow/shared`, because nothing here ever crosses the wire.
 * They are the hand-off between `ingestion/core/*` (pure parsing) and the
 * ingestion I/O layer (the watchers, which turn a {@link ParsedBlock} into a
 * `Session` row and a `Notification`).
 *
 * Unlike the wire types, instants here are real `Date`s: the parsers hand
 * straight to Prisma, which wants `Date`.
 */

/** Every `SessionType` an ingested item can land as. Never `TASK`/`DND`. */
export type IngestedSessionType = "ASSIGNMENT" | "EXAM" | "LECTURE";

/**
 * One calendar block recovered from an upstream payload — everything the
 * watcher needs to write a fixed `Session` row and nothing else.
 *
 * `durationMinutes` is guaranteed to be a positive multiple of 15 and
 * `scheduledStartTime` to sit on the 15-minute grid, because every parser
 * routes its raw times through {@link snapToGrid} (see `grid.ts`).
 */
export interface ParsedBlock {
  /**
   * Stable upstream identity, `"<source>:<kind>:<upstream id>"` — the value
   * that goes into `Session.externalKey` and makes a re-run idempotent via the
   * `[userId, externalKey]` unique index.
   */
  externalKey: string;
  title: string;
  type: IngestedSessionType;
  /** UTC instant the block starts, on the 15-minute grid. */
  scheduledStartTime: Date;
  /** Positive multiple of 15 (invariant #3). */
  durationMinutes: number;
  location: string | null;
  note: string | null;
}

/** A {@link ParsedBlock} from the Moodle calendar, tagged with its course. */
export interface ParsedLmsItem extends ParsedBlock {
  /**
   * The Moodle course this item belongs to — its `fullName` becomes a tag on
   * the session. Null when the event carried no usable `course` block.
   */
  lmsCourse: ParsedLmsCourse | null;
}

/** A distinct Moodle course seen in a calendar response — upserted as `LmsCourse`. */
export interface ParsedLmsCourse {
  lmsCourseId: number;
  fullName: string;
  shortName: string | null;
}

/** A {@link ParsedBlock} from the portal, tagged with its course section. */
export interface ParsedPortalItem extends ParsedBlock {
  /** Portal `ScheduleStudyUnitID`; joins to `PortalSection.scheduleStudyUnitId`. */
  scheduleStudyUnitId: string | null;
}

/** A distinct portal section seen in a timetable response — upserted as `PortalSection`. */
export interface ParsedPortalSection {
  scheduleStudyUnitId: string;
  curriculumId: string | null;
  curriculumName: string;
  yearStudy: string;
  termId: string;
  groupNo: string | null;
  teacherName: string | null;
  roomId: string | null;
  buildingName: string | null;
  campusName: string | null;
}

/**
 * An upstream record the parser deliberately dropped, and why.
 *
 * Pure code cannot log, so it *returns* its diagnostics: the watcher writes
 * these onto the run's job item so an item that silently never reached the
 * calendar is explainable after the fact (undocumented periods 5–6, a quiz
 * whose `close` event is in next month's fetch, a malformed date, …).
 */
export interface SkippedItem {
  /** Best available upstream identifier — an `externalKey` where one exists. */
  ref: string;
  reason: string;
}
