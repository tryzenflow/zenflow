import type { SkippedItem } from "./types";

/**
 * Every `Session.externalKey` format, in one place.
 *
 * `externalKey` is the ingestion idempotency guard: the watchers re-fetch the
 * same window on every tick, so every write upserts on `[userId, externalKey]`
 * and without it each tick would duplicate the student's whole calendar. The
 * formats used to live only as inline template literals in the two parsers plus
 * a narrative comment on the schema — and issue #56 adds three more consumers
 * (the occurrence-cache mappers and the fan-out path). Five hand-written copies
 * of one string format is how a cache silently stops matching its own sessions,
 * so the format lives here and nowhere else.
 *
 * ## The rule that decides what goes in a key
 *
 * Whatever is **inside** the key is *identity*: change it and the run reads as
 * "the old thing was cancelled, a new thing appeared". Whatever is **outside**
 * it is compared by `MaterializerService.differsFromUpstream` and becomes an
 * in-place update that preserves the row id, its tags, its reminders and — the
 * one that matters — the student's own `lastMovedAt`.
 *
 * So a key carries the least that still identifies the real-world activity.
 *
 * ## Why the portal lecture key is shaped the way it is (issue #56)
 *
 * It used to be `portal:meeting:<WeekScheduleID>`. `WeekScheduleID` is minted by
 * the portal **per (section, student)** — two classmates in the same group get
 * different ids for the same meeting. That made a lecture key student-specific,
 * which in turn made the cross-student occurrence cache impossible: a cached
 * section occurrence cannot mint another student's id, so a student whose
 * sections were all cache-fresh could never be served without a live fetch.
 *
 * The replacement is `(ScheduleStudyUnitID, meeting date, PeriodID)` — three
 * fields that all come straight off the timetable row and all describe the
 * *section's* meeting rather than whoever is reading it. A
 * `PortalSectionOccurrence` keyed on exactly that triple can therefore mint the
 * key for any confirmed student.
 *
 * Two alternatives were considered and rejected:
 *
 *  - **Date only, no period** (`…:<date>`) would make a start-period move an
 *    update rather than a cancel+create, but it collides for a section that
 *    meets twice on one day (a lecture plus its lab): the second meeting would
 *    overwrite the first and `reconcileDeleted` would then retire it as
 *    cancelled.
 *  - **Date plus an ordinal** (`…:<date>:<n>`, nth meeting of the day) survives
 *    the two-a-day case and keeps a period move as an update, but if the earlier
 *    of two same-day meetings is cancelled the survivor's ordinal shifts from 2
 *    to 1, and the run reports "meeting 1 changed time, meeting 2 removed". The
 *    resulting calendar is correct but the two notifications the student gets
 *    are a lie, and the outcome depends on one week's fetch being complete.
 *
 * The accepted cost of keeping `PeriodID`: a class whose start period moves
 * produces one `removed` plus one `created`. That is honest — the class moved by
 * hours, and the student needs to see both halves — and it costs only that one
 * row's `lastMovedAt`.
 *
 * Pure: no clock, no I/O, no Prisma (invariant #2 — this is `ingestion/core/*`).
 */

/** Prefix of every portal timetable-meeting key. */
const PORTAL_LECTURE_PREFIX = "portal:lecture";

/** Prefix of the pre-#56 timetable key. See {@link legacyPortalMeetingKey}. */
const LEGACY_PORTAL_MEETING_PREFIX = "portal:meeting";

/** The three fields that identify one meeting of one section. */
export interface PortalLectureKeyParts {
  /** The portal's `ScheduleStudyUnitID` — the section, shared by its students. */
  scheduleStudyUnitId: string;
  /** Meeting day as a `DLU_TZ` wall-clock `'YYYY-MM-DD'`. */
  meetingDate: string;
  /** First teaching period of the meeting (`PeriodID`). */
  periodId: number;
}

/**
 * `portal:lecture:<ScheduleStudyUnitID>:<YYYY-MM-DD>:<PeriodID>` — one meeting
 * of one class section, identical for every student in it.
 */
export function portalLectureKey(parts: PortalLectureKeyParts): string {
  return [
    PORTAL_LECTURE_PREFIX,
    parts.scheduleStudyUnitId,
    parts.meetingDate,
    String(parts.periodId),
  ].join(":");
}

/**
 * `portal:meeting:<WeekScheduleID>` — the **pre-#56** lecture key.
 *
 * Still emitted alongside the new key (as `ParsedPortalItem.legacyExternalKey`)
 * purely so `MaterializerService` can find an already-stored row under its old
 * name and rename it in place, instead of inserting a duplicate and letting
 * `reconcileDeleted` soft-delete the original — which would lose every
 * student's `lastMovedAt` and fire a "class removed" notification for every
 * lecture on every calendar.
 *
 * A walk only ever covers `[now, term.endDate]`, so rows from past terms are
 * never revisited and stay on the old key harmlessly. That makes this dead
 * weight one full term after the #56 deploy — remove it then (follow-up issue,
 * "drop the pre-#56 portal:meeting externalKey alias").
 */
export function legacyPortalMeetingKey(
  weekScheduleId: string | number,
): string {
  return `${LEGACY_PORTAL_MEETING_PREFIX}:${weekScheduleId}`;
}

/** True for a key in the pre-#56 lecture format. */
export function isLegacyPortalMeetingKey(key: string): boolean {
  return key.startsWith(`${LEGACY_PORTAL_MEETING_PREFIX}:`);
}

/**
 * `portal:exam:<Examination>` — unchanged by #56.
 *
 * The portal's `Examination` id is already shared by every student sitting the
 * exam (one exam row is handed to the whole section), so this key was
 * student-independent all along and needs no migration.
 */
export function portalExamKey(examination: string | number): string {
  return `portal:exam:${examination}`;
}

/**
 * `lms:assign:<instance>` — unchanged by #56.
 *
 * Keys on the Moodle **activity** `instance`, never the calendar event `id`: a
 * teacher re-creating a due date mints a fresh event id for the same activity.
 * `instance` is also shared across every enrolled student, so this key is
 * already cacheable cross-student.
 */
export function lmsAssignKey(instance: number): string {
  return `lms:assign:${instance}`;
}

/**
 * `lms:quiz:<instance>` — unchanged by #56.
 *
 * One quiz emits two calendar events (`open` and `close`) with different ids but
 * one `instance`, which is the other reason the LMS half keys on `instance`.
 */
export function lmsQuizKey(instance: number): string {
  return `lms:quiz:${instance}`;
}

/**
 * The `ref` a parser puts on a {@link SkippedItem} for a timetable row it
 * cannot key at all.
 *
 * Its own helper because a row that fails to produce a key by definition cannot
 * use one of the builders above, and "unknown" is a worse diagnostic than the
 * section id the row usually still carries.
 */
export function unkeyablePortalLectureRef(
  scheduleStudyUnitId: string | null | undefined,
): SkippedItem["ref"] {
  return `${PORTAL_LECTURE_PREFIX}:${scheduleStudyUnitId ?? "unknown"}`;
}
