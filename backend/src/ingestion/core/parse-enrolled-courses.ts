import type { ResolvedSemester } from "./semester";

/**
 * Moodle's enrolled-course list → this term's courses (issue #56).
 *
 * `core_course_get_enrolled_courses_by_timeline_classification` is called with
 * `classification: "allincludinghidden"`, which returns the student's **entire**
 * enrolment history — every course they have ever been in, across every term.
 * Discovery only wants the current one, so something has to filter, and the
 * response offers three imperfect signals to do it with.
 *
 * ## Why the verdict is advisory
 *
 * None of the three signals is authoritative:
 *
 *  - `hidden` is the strongest, but the captured sample shows `visible: true`
 *    and `hidden: true` on the *same* course, so the two are not complements and
 *    the pair is worth recording rather than collapsing.
 *  - `startdate` is a real epoch, but a course created early or backdated by a
 *    teacher sits outside the term window while still being this term's course.
 *  - `coursecategory` is a display string (`"Học kỳ 1"`) whose naming convention
 *    is entirely up to whoever set the Moodle up.
 *
 * So {@link classifyCurrentTerm} returns **both** halves with a reason per
 * exclusion, and its caller records the verdict without acting on it while
 * `INGESTION_LMS_TERM_FILTER=shadow`. That is what lets the filter be checked
 * against a real account — comparing what it would have dropped against what a
 * walk actually found — before it can cause a fetch to be skipped. Issue #56
 * requires exactly that ordering.
 *
 * Pure: no clock, no I/O; the term is always a parameter.
 */

/** One course from the enrolled-courses response (the fields we read). */
export interface MoodleEnrolledCourse {
  /** Moodle `course.id` — the cache and catalog key. */
  id?: number | null;
  fullname?: string | null;
  shortname?: string | null;
  /** Epoch **seconds**, as Moodle emits. `0` means "unset". */
  startdate?: number | null;
  enddate?: number | null;
  visible?: boolean | null;
  hidden?: boolean | null;
  /** Display string, e.g. `"Học kỳ 1"`. */
  coursecategory?: string | null;
}

/** A course that survived the filter, normalised for storage. */
export interface DiscoveredCourse {
  lmsCourseId: number;
  fullName: string;
  shortName: string | null;
  courseCategory: string | null;
  /** `null` when Moodle reported no start date (it emits `0`). */
  startDate: Date | null;
  hidden: boolean;
}

/** A course the filter would drop, and the single signal that dropped it. */
export interface ExcludedCourse extends DiscoveredCourse {
  reason: ExclusionReason;
}

/**
 * Why a course was excluded. A closed set so it can be a metric label without
 * unbounded cardinality.
 */
export type ExclusionReason =
  | "hidden"
  | "startdate-outside-term"
  | "category-mismatch";

/** What {@link classifyCurrentTerm} decided. */
export interface ClassifiedCourses {
  current: DiscoveredCourse[];
  excluded: ExcludedCourse[];
  /**
   * Courses kept despite an unrecognised `coursecategory`. Not an exclusion —
   * see {@link classifyCurrentTerm} — but the count worth watching, because a
   * Moodle that names categories differently makes that signal useless.
   */
  unknownCategory: number;
}

/** The term ordinal `"HK01"` → `1`, or `null` if it is not that shape. */
function termOrdinal(termId: string): number | null {
  const match = /^HK0?(\d)$/i.exec(termId.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Does `coursecategory` look like it names `ordinal`?
 *
 * Deliberately loose: it looks for the ordinal as a standalone number anywhere
 * in the string, so `"Học kỳ 1"`, `"HK1"` and `"Semester 1"` all match without
 * this function pretending to know the university's naming scheme.
 *
 * Returns `null` — "no opinion" — when the string carries no digit at all,
 * which is the case a strict match would wrongly read as a mismatch.
 */
function categoryNamesTerm(
  category: string | null,
  ordinal: number | null,
): boolean | null {
  if (!category || ordinal === null) return null;
  const digits = category.match(/\d+/g);
  if (!digits) return null;
  return digits.includes(String(ordinal));
}

/** Normalise one response row; `null` when it has no usable course id. */
function normalise(course: MoodleEnrolledCourse): DiscoveredCourse | null {
  const id = course?.id;
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  return {
    lmsCourseId: id,
    fullName: course.fullname?.trim() || String(id),
    shortName: course.shortname?.trim() || null,
    courseCategory: course.coursecategory?.trim() || null,
    // Moodle uses 0, not null, for "no start date".
    startDate:
      typeof course.startdate === "number" && course.startdate > 0
        ? new Date(course.startdate * 1000)
        : null,
    hidden: course.hidden === true,
  };
}

/**
 * Split an enrolment list into "this term" and "not this term".
 *
 * Signals are applied in order of how much they can be trusted, and the first
 * one that fires is the recorded `reason` — so a shadow-mode log says *which*
 * signal disagreed, not merely that something did:
 *
 *  1. `hidden: true` → excluded. A hidden course is one Moodle itself is not
 *     showing the student.
 *  2. A `startDate` outside `[term.startDate, term.endDate]` → excluded. A
 *     missing start date is **not** an exclusion: absence of evidence.
 *  3. A `coursecategory` that names a different term ordinal → excluded. A
 *     category with no digits, or an unparseable `termId`, counts as
 *     `unknownCategory` and the course is **kept** — this is the flimsiest
 *     signal and the one most likely to differ on a real Moodle, so it must
 *     never be the sole reason a course is dropped on a guess.
 */
export function classifyCurrentTerm(
  courses: readonly MoodleEnrolledCourse[] | null | undefined,
  term: Pick<ResolvedSemester, "semester" | "startDate" | "endDate">,
): ClassifiedCourses {
  const current: DiscoveredCourse[] = [];
  const excluded: ExcludedCourse[] = [];
  let unknownCategory = 0;

  const ordinal = termOrdinal(term.semester);
  const from = term.startDate.getTime();
  const to = term.endDate.getTime();

  for (const raw of courses ?? []) {
    const course = normalise(raw);
    if (!course) continue;

    if (course.hidden) {
      excluded.push({ ...course, reason: "hidden" });
      continue;
    }

    if (
      course.startDate &&
      (course.startDate.getTime() < from || course.startDate.getTime() > to)
    ) {
      excluded.push({ ...course, reason: "startdate-outside-term" });
      continue;
    }

    const categoryVerdict = categoryNamesTerm(course.courseCategory, ordinal);
    if (categoryVerdict === false) {
      excluded.push({ ...course, reason: "category-mismatch" });
      continue;
    }
    if (categoryVerdict === null) unknownCategory += 1;

    current.push(course);
  }

  return { current, excluded, unknownCategory };
}

/** Every course in the list, normalised, filter or no filter. */
export function allEnrolledCourses(
  courses: readonly MoodleEnrolledCourse[] | null | undefined,
): DiscoveredCourse[] {
  const out: DiscoveredCourse[] = [];
  for (const raw of courses ?? []) {
    const course = normalise(raw);
    if (course) out.push(course);
  }
  return out;
}
