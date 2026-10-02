import { readFileSync } from "fs";
import { join } from "path";

/**
 * The `scripts/fixtures/dlu/*.json` fixture set, loaded once and indexed for
 * `fake-dlu-server.ts`.
 *
 * ## Why the fake server needs this at all
 *
 * The fake server used to synthesise its own data per request: three hardcoded
 * courses, three sections, three exams, the same for everybody. That is fine for
 * exercising a parser but **useless for measuring the issue-#56 cache**, because
 * the whole saving comes from students *sharing* sections. With ad-hoc data every
 * student looks like they attend different classes, so there is nothing to share
 * and the measured redundancy is an artefact of the generator.
 *
 * The fixture set is 150 students across 9 departments with real cohort
 * structure: department cores carry ~9-12 students, electives up to ~19, and
 * `ScheduleStudyUnitID`s are genuinely shared between classmates. That is what
 * makes "one student's walk warms the cohort" measurable.
 *
 * ## Identity: the part the upstreams do not give us
 *
 * Every fixture file is keyed by `StudentID`, but neither upstream's *data*
 * request carries one — the portal identifies the caller by bearer token and
 * Moodle by session cookie, both of which the fake previously minted as random
 * strings. So both are made to carry the student:
 *
 *  - portal: `authenticate` mints `fake-portal-token-<StudentID>` from the
 *    username in the login body, and every portal route reads it back off
 *    `Authorization`.
 *  - Moodle: the login POST (the one request that *does* carry a username) sets
 *    `MoodleSession=auth-<StudentID>`, and `/my/` plus the AJAX endpoint read the
 *    student off the cookie.
 *
 * Only ever loaded by the fake server and the measurement script — never by
 * `src/`.
 */

const DIR = join(__dirname, "fixtures", "dlu");

function load<T>(name: string): T {
  const raw = readFileSync(join(DIR, `${name}.json`), "utf8");
  const parsed = JSON.parse(raw) as T & { _comment?: string };
  // `generate.js` prepends a `_comment` key to most files; it is documentation,
  // not data, and would otherwise show up as a student id.
  if (parsed && typeof parsed === "object") delete parsed._comment;
  return parsed;
}

export interface FixtureStudent {
  StudentID: string;
  StudentName: string;
  StudyProgramID: string;
  SecondaryStudyProgramID?: string | null;
  portalUsername: string;
  portalPassword: string;
  lmsUsername: string;
  lmsPassword: string;
}

export interface FixtureSection {
  ScheduleStudyUnitID: string;
  CurriculumID: string;
  CurriculumName: string;
  StudyUnitID: string;
  YearStudy: string;
  TermID: string;
  GroupNo: string;
  /** 0 = Monday … 6 = Sunday, within the reference week. */
  weekdayOffset: number;
  PeriodID: number;
  NumberOfPeriods: number;
  RoomID: string;
  BuildingName: string;
  CampusName: string;
  FullName: string;
  students: string[];
}

export interface FixtureTimetableRow {
  WeekScheduleID: number;
  ScheduleStudyUnitID: string;
  CurriculumName: string;
  PeriodID: number;
  NumberOfPeriods: number;
  Ngay: string;
  RoomID: string;
  BuildingName: string;
  CampusName: string;
  FullName: string;
  YearStudy: string;
  TermID: string;
  TKHHienThi: string;
}

export interface FixtureExamRow {
  Examination: number;
  ScheduleStudyUnitID: string;
  CurriculumID: string;
  CurriculumName: string;
  NgayThi: string;
  GioThi: string;
  ThoiLuong: string;
  PhongThi: string;
  DiaDiem: string;
  HinhThucThi: string;
}

export interface FixtureLmsCourse {
  id: number;
  fullname: string;
  shortname: string;
  coursecategory: string;
  startdate: number;
  hidden: boolean;
}

export interface FixtureLmsEvent {
  id: number;
  name: string;
  modulename: string;
  instance: number;
  eventtype: string;
  timestart: number;
  timesort: number;
  url: string;
  description: string;
  course: { id: number; fullname: string; shortname: string };
}

export interface DluFixtures {
  students: FixtureStudent[];
  /** `portalUsername` and `lmsUsername`, both lowercased, → `StudentID`. */
  studentIdByUsername: Map<string, string>;
  byId: Map<string, FixtureStudent>;
  sections: FixtureSection[];
  /** `studentId` → the reference week's rows. */
  timetableRows: Record<string, FixtureTimetableRow[]>;
  /** The ISO week `portal-timetable.json`'s dates belong to. */
  referenceWeek: number;
  referenceYear: string;
  referenceTerm: string;
  examRows: Record<string, FixtureExamRow[]>;
  /** `studentId` → DKHP registration events (the whole log, every term). */
  registHistory: Record<string, unknown[]>;
  yearTerm: unknown;
  lmsCourses: Map<number, FixtureLmsCourse>;
  /** `studentId` → Moodle course ids. */
  enrollments: Record<string, number[]>;
  /** Moodle course id → its calendar events. */
  eventsByCourse: Record<string, FixtureLmsEvent[]>;
}

let cached: DluFixtures | null = null;

/** Drop the memoised set so the next load re-reads the JSON (benchmark edits). */
export function resetDluFixtureCache(): void {
  cached = null;
}

/** Load (and memoise) the fixture set. Throws if it has not been generated. */
export function loadDluFixtures(): DluFixtures {
  if (cached) return cached;

  const students = load<FixtureStudent[]>("students");
  const sectionsFile = load<{ sections: FixtureSection[] }>("portal-sections");
  const timetable = load<{
    namhoc: string;
    hocky: string;
    tuan: number;
    rows: Record<string, FixtureTimetableRow[]>;
  }>("portal-timetable");
  const exams = load<{ rows: Record<string, FixtureExamRow[]> }>(
    "portal-exams",
  );
  const registHistory = load<Record<string, unknown[]>>(
    "portal-regist-history",
  );
  const yearTerm = load<unknown>("portal-year-term");
  const lmsCourses = load<FixtureLmsCourse[]>("lms-courses");
  const lmsEvents = load<{
    events: Record<
      string,
      (Omit<FixtureLmsEvent, "timesort" | "course"> & {
        timesort?: number;
      })[]
    >;
    enrolledCourses: Record<string, number[]>;
  }>("lms-events");
  const courseById = new Map(lmsCourses.map((c) => [c.id, c]));

  // `generate.js` stores events under their course id and leaves out the two
  // fields that would only repeat that: `timesort` (Moodle's sort key, equal to
  // `timestart` for every event type the fixtures carry) and the embedded
  // `course`. Filled back in here so the fake serves Moodle's real shape.
  const eventsByCourse: Record<string, FixtureLmsEvent[]> = {};
  for (const [courseId, events] of Object.entries(lmsEvents.events)) {
    const course = courseById.get(Number(courseId));
    eventsByCourse[courseId] = events.map((event) => ({
      ...event,
      timesort: event.timesort ?? event.timestart,
      course: {
        id: Number(courseId),
        fullname: course?.fullname ?? `Course ${courseId}`,
        shortname: course?.shortname ?? `C${courseId}`,
      },
    }));
  }

  const studentIdByUsername = new Map<string, string>();
  const byId = new Map<string, FixtureStudent>();
  for (const s of students) {
    byId.set(s.StudentID, s);
    studentIdByUsername.set(s.portalUsername.toLowerCase(), s.StudentID);
    studentIdByUsername.set(s.lmsUsername.toLowerCase(), s.StudentID);
  }

  cached = {
    students,
    studentIdByUsername,
    byId,
    sections: sectionsFile.sections,
    timetableRows: timetable.rows,
    referenceWeek: timetable.tuan,
    referenceYear: timetable.namhoc,
    referenceTerm: timetable.hocky,
    examRows: exams.rows,
    registHistory,
    yearTerm,
    lmsCourses: courseById,
    enrollments: lmsEvents.enrolledCourses,
    eventsByCourse,
  };
  return cached;
}

/** Are the fixtures present? `generate.js` has to have been run. */
export function fixturesAvailable(): boolean {
  try {
    loadDluFixtures();
    return true;
  } catch {
    return false;
  }
}
