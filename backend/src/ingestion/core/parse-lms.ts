import { GRID_MINUTES, floorToGrid, snapInstantsToGrid } from "./grid";
import type { ParsedLmsCourse, ParsedLmsItem, SkippedItem } from "./types";

/**
 * Moodle `core_calendar_get_calendar_monthly_view` → calendar blocks.
 *
 * The DLU LMS is a Moodle whose calendar AJAX endpoint returns a month as a
 * grid of weeks → days → events. Everything we need is in that one response;
 * there is no crawling and no per-activity fetch.
 *
 * Three things about the payload drive this parser:
 *
 * 1. **`timestart` is a genuine Unix epoch in seconds.** `new Date(t * 1000)`
 *    is the correct instant, full stop. It is tempting to "convert it to
 *    Vietnam time" because the LMS renders it that way — doing so shifts every
 *    deadline by 7 hours (and, if done twice, by 14). Never re-zone it.
 * 2. **A quiz emits two events sharing one `instance`** — `eventtype: "open"`
 *    and `eventtype: "close"`, both with `timeduration: 0`. The open→close
 *    window is therefore recoverable from the calendar alone, but only if the
 *    events are grouped by `instance` and not by event `id` (the captured pair
 *    is 700004/700005 under instance 800004).
 * 3. **`instance` is the stable activity identity, event `id` is not.** A
 *    teacher who re-creates a due date mints a fresh event id for the same
 *    activity, which would duplicate the session. So `externalKey` is built
 *    from `instance`.
 *
 * Pure: `now` is a parameter, nothing here reads a clock or does I/O.
 */

/** Moodle course block embedded in every calendar event. */
export interface MoodleCourseRef {
  id: number;
  fullname?: string | null;
  shortname?: string | null;
}

/** One event as it appears in `data.weeks[].days[].events[]`. */
export interface MoodleCalendarEvent {
  id: number;
  name: string;
  /** `"assign"`, `"quiz"`, `"attendance"`, … */
  modulename?: string | null;
  /** The activity id — stable across event re-creation. */
  instance?: number | null;
  /** `"due"` for assignments; `"open"` / `"close"` for quizzes. */
  eventtype?: string | null;
  /** Unix epoch **seconds**. */
  timestart: number;
  /** Unix epoch seconds Moodle sorts by; equals `timestart` in practice. */
  timesort?: number | null;
  location?: string | null;
  course?: MoodleCourseRef | null;
}

/** The `data` object of a `core_calendar_get_calendar_monthly_view` response. */
export interface MoodleMonthlyView {
  weeks?:
    | { days?: { events?: MoodleCalendarEvent[] | null }[] | null }[]
    | null;
}

/** Everything one month's calendar yielded. */
export interface ParsedMonthlyView {
  items: ParsedLmsItem[];
  /** Distinct courses seen, for the `LmsCourse` upsert. */
  courses: ParsedLmsCourse[];
  /** Events deliberately dropped, with the reason, for the job item. */
  skipped: SkippedItem[];
}

/** Only these Moodle modules become sessions. `attendance` is explicitly not one. */
const INGESTED_MODULES = new Set(["assign", "quiz"]);

/**
 * A quiz window at or under this many minutes is blocked out contiguously; a
 * longer one (a take-home quiz open for days) would swallow the calendar, so
 * it degrades to a reminder before the close.
 */
export const CONTIGUOUS_QUIZ_LIMIT_MINUTES = 200;

const MS_PER_MINUTE = 60_000;

/** Round an instant down to the 15-minute grid. */
function floorInstant(at: Date): Date {
  return new Date(floorToGrid(at.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);
}

/**
 * The `[floor15(deadline) − 15min, floor15(deadline))` block both a due
 * assignment and a long/close-only quiz collapse to: one slot of "hand this
 * in" time, ending on the deadline's slot boundary.
 */
function reminderBefore(deadline: Date): {
  scheduledStartTime: Date;
  durationMinutes: number;
} {
  const end = floorInstant(deadline);
  const start = new Date(end.getTime() - GRID_MINUTES * MS_PER_MINUTE);
  return snapInstantsToGrid(start, end);
}

/**
 * Moodle names a quiz's two calendar events by suffixing the activity name
 * ("… mở" / "… đóng", "… opens" / "… closes"). A block that spans the whole
 * window is neither, so the suffix is stripped for the session title.
 */
function quizTitle(name: string): string {
  return name.replace(/\s+(mở|đóng|opens|closes)$/iu, "").trim() || name;
}

/** Flatten `weeks[].days[].events[]`, tolerating any missing level. */
function allEvents(view: MoodleMonthlyView | null | undefined) {
  const events: MoodleCalendarEvent[] = [];
  for (const week of view?.weeks ?? []) {
    for (const day of week?.days ?? []) {
      for (const event of day?.events ?? []) {
        if (event) events.push(event);
      }
    }
  }
  return events;
}

/** Epoch seconds Moodle would sort this event by. */
const sortSeconds = (event: MoodleCalendarEvent) =>
  event.timesort ?? event.timestart;

/**
 * Parse one month of the Moodle calendar into calendar blocks.
 *
 * Kept: `assign` and `quiz` events whose sort time is strictly **after**
 * `now`. Everything else is dropped silently — in particular `attendance`,
 * which fires once per class meeting and would bury the calendar in 15-minute
 * roll-call blocks that duplicate the portal timetable.
 *
 * Emission rules:
 *
 * | input | block | type |
 * | --- | --- | --- |
 * | `assign` / `due` | 15 min ending at the deadline slot | `ASSIGNMENT` |
 * | `quiz`, open+close ≤ 200 min apart | the whole window, snapped | `EXAM` |
 * | `quiz`, open+close > 200 min apart | 15 min before the close | `EXAM` |
 * | `quiz`, close only | 15 min before the close | `EXAM` |
 * | `quiz`, open only | *skipped* — the close is in next month's fetch | — |
 *
 * "Open only" is why the watcher fetches the current **and** next month: a
 * quiz that opens on the 30th and closes on the 2nd is a lone open in one
 * response and a complete pair in the other.
 */
export function parseMonthlyView(
  view: MoodleMonthlyView | null | undefined,
  now: Date,
): ParsedMonthlyView {
  const nowSeconds = now.getTime() / 1000;

  const candidates = allEvents(view).filter(
    (event) =>
      INGESTED_MODULES.has(event.modulename ?? "") &&
      sortSeconds(event) > nowSeconds,
  );

  const items: ParsedLmsItem[] = [];
  const skipped: SkippedItem[] = [];
  const courses = new Map<number, ParsedLmsCourse>();

  // Courses come from every candidate, including ones that end up skipped —
  // the course is real either way and the next month's fetch will want it.
  for (const event of candidates) {
    const course = event.course;
    if (course && Number.isInteger(course.id) && !courses.has(course.id)) {
      courses.set(course.id, {
        lmsCourseId: course.id,
        fullName: course.fullname?.trim() || String(course.id),
        shortName: course.shortname?.trim() || null,
      });
    }
  }

  for (const event of candidates) {
    if (event.modulename !== "assign") continue;
    if (!Number.isInteger(event.instance)) {
      skipped.push({
        ref: `lms:assign:event-${event.id}`,
        reason: "assignment event has no instance id",
      });
      continue;
    }
    items.push({
      externalKey: `lms:assign:${event.instance}`,
      title: event.name,
      type: "ASSIGNMENT",
      // `timestart` IS the due instant; the block sits just before it.
      ...reminderBefore(new Date(event.timestart * 1000)),
      location: event.location?.trim() || null,
      note: null,
      lmsCourseId: event.course?.id ?? null,
    });
  }

  // Group quizzes by `instance` — the two events of one quiz have different ids.
  const quizzes = new Map<number, MoodleCalendarEvent[]>();
  for (const event of candidates) {
    if (event.modulename !== "quiz") continue;
    if (!Number.isInteger(event.instance)) {
      skipped.push({
        ref: `lms:quiz:event-${event.id}`,
        reason: "quiz event has no instance id",
      });
      continue;
    }
    const group = quizzes.get(event.instance!) ?? [];
    group.push(event);
    quizzes.set(event.instance!, group);
  }

  for (const [instance, group] of quizzes) {
    const externalKey = `lms:quiz:${instance}`;
    const open = group.find((e) => e.eventtype === "open");
    const close = group.find((e) => e.eventtype === "close");

    if (!close) {
      skipped.push({
        ref: externalKey,
        reason: open
          ? "quiz open event without its close (expected in the next month's fetch)"
          : "quiz has neither an open nor a close event",
      });
      continue;
    }

    const closeAt = new Date(close.timestart * 1000);
    const base = {
      externalKey,
      title: quizTitle(close.name),
      type: "EXAM" as const,
      location: close.location?.trim() || null,
      note: null,
      lmsCourseId: close.course?.id ?? null,
    };

    if (!open) {
      // Deadline-shaped: only the close survived the `now` filter.
      items.push({ ...base, ...reminderBefore(closeAt) });
      continue;
    }

    const openAt = new Date(open.timestart * 1000);
    const windowMinutes =
      (closeAt.getTime() - openAt.getTime()) / MS_PER_MINUTE;

    items.push({
      ...base,
      ...(windowMinutes > 0 && windowMinutes <= CONTIGUOUS_QUIZ_LIMIT_MINUTES
        ? // A sit-down quiz: block the whole window out.
          snapInstantsToGrid(openAt, closeAt)
        : // Open for days (or inverted data): a reminder, not a blockade.
          reminderBefore(closeAt)),
    });
  }

  return { items, courses: [...courses.values()], skipped };
}
