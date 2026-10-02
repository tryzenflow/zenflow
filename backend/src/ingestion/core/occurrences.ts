import { createHash } from "crypto";
import { lmsAssignKey, lmsQuizKey, portalLectureKey } from "./external-key";
import type {
  IngestedSessionType,
  ParsedLmsItem,
  ParsedPortalItem,
} from "./types";

/**
 * The round trip between what a walk parsed and what the cross-student cache
 * stores (issue #56).
 *
 * A walk's output is per student by accident of how it was fetched, but the
 * *content* is a property of the section or course: every student in
 * `99910AB100101` attends the same meeting, in the same room, at the same time.
 * These functions move between the two representations:
 *
 * ```
 *   ParsedPortalItem[]  --occurrencesFromTimetable-->  PortalOccurrenceInput[]
 *   PortalOccurrenceInput[] / stored rows  --blocksFrom...-->  ParsedPortalItem[]
 * ```
 *
 * The round trip has to be exact: a block rebuilt from cache is handed to the
 * **same** `MaterializerService.materialize` a live walk uses, so if it differed
 * in any compared field (title, note, location, duration, start) the cache would
 * manufacture a phantom "upstream change" and notify every student about it on
 * every pass. `occurrences.spec.ts` asserts the round trip as a property, which
 * is the single strongest test in this change — and it is only *possible*
 * because the lecture `externalKey` is now derivable from the section's own
 * coordinates rather than from a per-student `WeekScheduleID`.
 *
 * Pure: no clock, no I/O; freshness takes `now` as a parameter.
 */

/** A section meeting as the cache stores it. */
export interface PortalOccurrenceInput {
  scheduleStudyUnitId: string;
  /** DLU-local `'YYYY-MM-DD'` — part of the identity, never re-derived. */
  meetingDate: string;
  periodId: number;
  numberOfPeriods: number;
  isoWeek: number;
  yearStudy: string;
  termId: string;
  startsAt: Date;
  durationMinutes: number;
  title: string;
  roomId: string | null;
  teacherName: string | null;
}

/** A Moodle activity as the cache stores it. */
export interface LmsOccurrenceInput {
  lmsCourseId: number;
  externalKey: string;
  type: IngestedSessionType;
  startsAt: Date;
  durationMinutes: number;
  title: string;
  note: string | null;
  location: string | null;
}

/** The `note` a portal lecture block carries: the teacher, or nothing. */
export function lectureNote(teacherName: string | null): string | null {
  return teacherName ? `GV: ${teacherName}` : null;
}

/** `"GV: Nguyễn Văn A"` → `"Nguyễn Văn A"`; anything else → `null`. */
function teacherFromNote(note: string | null): string | null {
  const match = /^GV:\s*(.+)$/.exec(note ?? "");
  return match ? match[1] : null;
}

/**
 * A timetable walk's lectures → cache rows.
 *
 * Only items carrying the full identity triple survive, which since the #56
 * re-key is every item `parseTimetable` emits — a row it could not key is
 * skipped there rather than here.
 */
export function occurrencesFromTimetable(
  items: readonly ParsedPortalItem[],
  coords: { isoWeek: number; yearStudy: string; termId: string },
): PortalOccurrenceInput[] {
  const out: PortalOccurrenceInput[] = [];
  for (const item of items) {
    if (item.type !== "LECTURE") continue;
    if (
      !item.scheduleStudyUnitId ||
      !item.meetingDate ||
      item.periodId === null ||
      item.periodId === undefined
    ) {
      continue;
    }
    out.push({
      scheduleStudyUnitId: item.scheduleStudyUnitId,
      meetingDate: item.meetingDate,
      periodId: item.periodId,
      numberOfPeriods: item.numberOfPeriods ?? 1,
      isoWeek: coords.isoWeek,
      yearStudy: coords.yearStudy,
      termId: coords.termId,
      startsAt: item.scheduledStartTime,
      durationMinutes: item.durationMinutes,
      title: item.title,
      roomId: item.location,
      teacherName: teacherFromNote(item.note),
    });
  }
  return out;
}

/** Cache rows → the blocks `MaterializerService.materialize` takes. */
export function blocksFromPortalOccurrences(
  rows: readonly PortalOccurrenceInput[],
): ParsedPortalItem[] {
  return rows.map((row) => ({
    externalKey: portalLectureKey({
      scheduleStudyUnitId: row.scheduleStudyUnitId,
      meetingDate: row.meetingDate,
      periodId: row.periodId,
    }),
    // Deliberately absent. `WeekScheduleID` is per-student, so a cached row
    // cannot know this student's legacy key — which is exactly why a student is
    // never served from cache until their own rows have been adopted by one live
    // walk. See `decide()` in the timetable watcher.
    legacyExternalKey: null,
    title: row.title,
    type: "LECTURE" as const,
    scheduledStartTime: row.startsAt,
    durationMinutes: row.durationMinutes,
    location: row.roomId,
    note: lectureNote(row.teacherName),
    scheduleStudyUnitId: row.scheduleStudyUnitId,
    meetingDate: row.meetingDate,
    periodId: row.periodId,
    numberOfPeriods: row.numberOfPeriods,
  }));
}

/** An LMS walk's items → cache rows. */
export function occurrencesFromLms(
  items: readonly ParsedLmsItem[],
): LmsOccurrenceInput[] {
  const out: LmsOccurrenceInput[] = [];
  for (const item of items) {
    const courseId = item.lmsCourse?.lmsCourseId;
    // An item whose event carried no usable course block cannot be shared with
    // anyone: there is no course to key it under.
    if (typeof courseId !== "number") continue;
    out.push({
      lmsCourseId: courseId,
      externalKey: item.externalKey,
      type: item.type,
      startsAt: item.scheduledStartTime,
      durationMinutes: item.durationMinutes,
      title: item.title,
      note: item.note,
      location: item.location,
    });
  }
  return out;
}

/**
 * LMS cache rows → blocks.
 *
 * `lmsCourse` is rebuilt from the catalog, because the course's `fullName`
 * becomes a tag on the session (`tagNamesOf`) — omit it and a cache-served
 * student silently loses the course tag a walked student gets.
 */
export function blocksFromLmsOccurrences(
  rows: readonly LmsOccurrenceInput[],
  courses: ReadonlyMap<number, { fullName: string; shortName: string | null }>,
): ParsedLmsItem[] {
  return rows.map((row) => {
    const course = courses.get(row.lmsCourseId);
    return {
      externalKey: row.externalKey,
      title: row.title,
      type: row.type,
      scheduledStartTime: row.startsAt,
      durationMinutes: row.durationMinutes,
      location: row.location,
      note: row.note,
      lmsCourse: course
        ? {
            lmsCourseId: row.lmsCourseId,
            fullName: course.fullName,
            shortName: course.shortName,
          }
        : null,
    };
  });
}

/** The `externalKey` an LMS occurrence row would produce, from its parts. */
export function lmsOccurrenceKey(
  type: IngestedSessionType,
  instance: number,
): string {
  return type === "ASSIGNMENT" ? lmsAssignKey(instance) : lmsQuizKey(instance);
}

/**
 * Can the cached data for one section/course answer for a student's window?
 *
 *  1. `refreshedAt` within `ttlMs` — was it read recently? Past the TTL one
 *     student's walk refreshes the section live and populates every classmate;
 *     until then nobody refetches it.
 *  2. `throughDate` at or past `requiredThrough` — did that read cover the
 *     window we are about to answer from it?
 *
 * The second is the one an aggregate over occurrence rows could not express. A
 * section read by a walk that only reached last Friday is *not* usable for a
 * student looking at next month: serving them from it would silently truncate
 * their calendar at the point the other student's walk happened to stop.
 */
export function isCoverageFresh(
  coverage: {
    refreshedAt: Date | null | undefined;
    throughDate?: Date | null | undefined;
  },
  now: Date,
  ttlMs: number,
  requiredThrough?: Date,
): boolean {
  if (!coverage.refreshedAt) return false;
  if (now.getTime() - coverage.refreshedAt.getTime() > ttlMs) return false;
  if (requiredThrough) {
    if (!coverage.throughDate) return false;
    if (coverage.throughDate.getTime() < requiredThrough.getTime())
      return false;
  }
  return true;
}

/**
 * Did a re-read actually change this occurrence?
 *
 * Compares exactly the fields that reach a `Session`, so a fan-out only happens
 * when a student would see something different. `lastSeenAt` and `isoWeek` are
 * bookkeeping and deliberately excluded — bumping them on every pass must not
 * look like a room change to every classmate.
 */
export function portalOccurrenceChanged(
  existing: {
    startsAt: Date;
    durationMinutes: number;
    title: string;
    roomId: string | null;
    teacherName: string | null;
  },
  incoming: PortalOccurrenceInput,
): boolean {
  return (
    existing.startsAt.getTime() !== incoming.startsAt.getTime() ||
    existing.durationMinutes !== incoming.durationMinutes ||
    existing.title !== incoming.title ||
    existing.roomId !== incoming.roomId ||
    existing.teacherName !== incoming.teacherName
  );
}

/** As {@link portalOccurrenceChanged}, for an LMS activity. */
export function lmsOccurrenceChanged(
  existing: {
    startsAt: Date;
    durationMinutes: number;
    title: string;
    note: string | null;
    location: string | null;
  },
  incoming: LmsOccurrenceInput,
): boolean {
  return (
    existing.startsAt.getTime() !== incoming.startsAt.getTime() ||
    existing.durationMinutes !== incoming.durationMinutes ||
    existing.title !== incoming.title ||
    existing.note !== incoming.note ||
    existing.location !== incoming.location
  );
}

// ── the divergence guard (LMS) ─────────────────────────────────────────────
//
// A lecture meeting belongs to its section, so any student's walk can speak for
// every classmate. A Moodle activity is shared by *key* but not necessarily by
// *content* or even *visibility*: Moodle has per-user and per-group due-date
// overrides and group-restricted activities. One student's view of such a unit
// is therefore never assumed to be anyone else's. Two rules follow:
//
//  1. SERVE — a student may be answered from cache only while the cached rows
//     of every unit still fingerprint to exactly that student's OWN last live
//     view. Whatever a classmate sees differently, the fingerprints disagree
//     and the student walks. The cache can hand a student back what they last
//     saw — the saving is the skipped login and fetch — but never a classmate's
//     view.
//  2. FAN OUT — a change is pushed to classmates only once two DIFFERENT
//     students have each observed the same before -> after transition, and only
//     to classmates whose own last view was that "before". One student's
//     extension never travels. See {@link observeUnit} for the state machine.

/**
 * A stable fingerprint of one student's view of one unit (a course's
 * activities) within `scope`.
 *
 * `scope` names what the view covers — the fetched months for Moodle — so two
 * views of different windows never compare equal. Items are canonicalised and
 * sorted, so row order is irrelevant; every field that reaches a `Session` is
 * included, so any change a student could see changes it.
 */
function fingerprintOf(scope: string, lines: string[]): string {
  const body = [...lines].sort().join("\n");
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 32);
  return `${scope}#${digest}`;
}

/** Fingerprint of one course's Moodle activities. */
export function lmsFingerprint(
  scope: string,
  rows: readonly LmsOccurrenceInput[],
): string {
  return fingerprintOf(
    scope,
    rows.map((r) =>
      JSON.stringify([
        r.externalKey,
        r.type,
        r.startsAt.toISOString(),
        r.durationMinutes,
        r.title,
        r.note,
        r.location,
      ]),
    ),
  );
}

/** One unit's agreement state, as stored on its catalog row. */
export interface UnitAgreement {
  /** The last walker's view of the unit. */
  fingerprint: string | null;
  /** Who that walker was. */
  by: string | null;
  /**
   * What that walker had seen before this view. Equal to `fingerprint` once a
   * transition has been fanned out — the marker that stops it going out twice.
   */
  prior: string | null;
}

/**
 * Fold one student's fresh observation of a unit into its agreement state.
 *
 * `before` is the student's own previous view (null if they have none), `after`
 * what this walk just saw. A transition is **corroborated** — and only then
 * safe to fan out — when a different student already reported the identical
 * `before -> after` move. The cases that matter:
 *
 *  - one student's extension: only they ever move `X -> Y`; everyone else keeps
 *    reporting `X -> X`. Never corroborated, never fanned out.
 *  - a genuine change: the first walker reports `X -> Y`, the second the same.
 *    Corroborated on the second, fanned out once, then marked propagated so the
 *    third, fourth… walker does not fan it out again.
 *  - a walk in between that still sees `X` resets the state, so a corroboration
 *    has to be two consecutive agreeing reports, not two anywhere in history.
 *
 * Residual risk, stated plainly: an override shared by a *group* of two or more
 * students can be corroborated and fanned out to non-members. It is bounded —
 * fan-out never updates a recipient's own seen fingerprint, so their next pass
 * no longer matches the cache and walks live, restoring their real view.
 */
export function observeUnit(
  unit: UnitAgreement,
  observation: { userId: string; before: string | null; after: string },
): { next: UnitAgreement; corroborated: boolean } {
  const { userId, before, after } = observation;

  const corroborated =
    before !== null &&
    before !== after &&
    unit.fingerprint === after &&
    unit.prior === before &&
    unit.by !== null &&
    unit.by !== userId;
  if (corroborated) {
    return {
      next: { fingerprint: after, by: userId, prior: after },
      corroborated,
    };
  }

  // Already propagated and still what everyone sees: leave the marker alone, or
  // the next agreeing walker would look like a fresh transition.
  if (unit.fingerprint === after && unit.prior === after) {
    return { next: unit, corroborated: false };
  }

  return {
    next: { fingerprint: after, by: userId, prior: before },
    corroborated: false,
  };
}
