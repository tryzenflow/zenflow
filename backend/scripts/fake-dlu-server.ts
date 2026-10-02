/**
 * Fake LMS (Moodle) + student-portal server, for exercising the ingestion
 * watchers (`src/ingestion/*-watcher.service.ts`) without touching the real
 * university systems. One process answers both upstreams, since their paths
 * never collide: Moodle owns `/login/*`, `/my/`, `/lib/ajax/*`; the portal
 * owns `/api/*`.
 *
 * Run:
 *   pnpm --filter backend exec ts-node scripts/fake-dlu-server.ts
 *
 * Point `.env.dev` at it and restart `start:dev`:
 *   LMS_URL="http://localhost:4100"
 *   PORTAL_API_URL="http://localhost:4100"
 *   PORTAL_API_KEY="fake-api-key"          # any value — never checked
 *   DKHP_API_URL="http://localhost:4100"
 *   DKHP_API_KEY="fake-dkhp-api-key"       # any non-empty value (or FAKE_DKHP_API_KEY)
 *
 * Optional: FAKE_DLU_LATENCY_MS=<ms> delays every upstream response;
 * FAKE_DLU_JITTER_MS=<ms> adds a uniform random 0..ms on top.
 *
 * Any username/password logs in on both endpoints. To exercise the
 * `INVALID_CREDENTIALS` path (`LMSService.login` / `PortalAPIService.authenticate`),
 * use the password "wrongpass" — both fake endpoints reject it the way the
 * real ones do (Moodle re-renders the login form; the portal answers 401).
 *
 * ## Two data sources
 *
 * If `scripts/fixtures/dlu/*.json` has been generated (`node generate.js` in that
 * directory), the server serves **from the fixture set**: 150 students across 9
 * departments, with `ScheduleStudyUnitID`s genuinely shared between classmates.
 * That sharing is the whole point — the issue-#56 cache saves work precisely
 * because students attend the same sections, so ad-hoc per-request data makes the
 * saving unmeasurable.
 *
 * Without the fixtures (or for a student the fixtures do not know) it falls back
 * to the ad-hoc generator below, so existing single-student flows keep working.
 *
 * Serving from fixtures needs to know *who is asking*, which neither upstream's
 * data request carries — see `fake-dlu-fixtures.ts` for how the bearer token and
 * the Moodle cookie are made to carry the student id.
 *
 * ## The ad-hoc fallback
 *
 * Data generated fresh per request, anchored on the real wall clock, so
 * whichever month/week/term the watcher asks for comes back populated:
 *  - the LMS calendar always has two `assign` due dates and one same-month
 *    `quiz` (open+close) in the requested month, PLUS a quiz whose `open`
 *    lands in one month and `close` in the next — the split case
 *    `parse-lms.ts` exists to handle (a quiz that opens the 30th, closes the 2nd).
 *  - the portal timetable always has Mon/Wed/Fri lecture rows for the
 *    requested `(namhoc, hocky, tuan)`.
 *  - the portal exam list always has 3 exams a few weeks out from today.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  fixturesAvailable,
  loadDluFixtures,
  resetDluFixtureCache,
  type FixtureLmsEvent,
  type FixtureTimetableRow,
} from "./fake-dlu-fixtures";

const PORT = Number(process.env.FAKE_DLU_PORT ?? 4100);
const REJECT_PASSWORD = "wrongpass";
/**
 * The DKHP calls must carry `clientid: dtl` and an `apikey`. Any non-empty key
 * passes, unless `FAKE_DKHP_API_KEY` is set, in which case it must match.
 */
const DKHP_API_KEY = process.env.FAKE_DKHP_API_KEY ?? "";
const DKHP_CLIENT_ID = "dtl";
function dkhpKeyOk(req: IncomingMessage): boolean {
  const key = req.headers.apikey;
  if (typeof key !== "string" || key.length === 0) return false;
  return DKHP_API_KEY === "" || key === DKHP_API_KEY;
}
/** Per-request delay in ms, so wall-clock time means something in a benchmark. */
const LATENCY_MS = Number(process.env.FAKE_DLU_LATENCY_MS ?? 0);
// Uniform extra delay in [0, JITTER_MS] on top of the base latency, so response
// times vary the way a real upstream's do instead of being a constant.
const JITTER_MS = Number(process.env.FAKE_DLU_JITTER_MS ?? 0);
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// request counting — GET /_/stats, POST /_/reset
//
// Keyed by the REQUEST'S IDENTITY, not the raw URL: the LMS calendar call
// carries a per-login `sesskey` in its query string, so two logins asking
// for the same month would otherwise look like different keys. Counting by
// (operation, the actual addressed resource) is what makes `total` vs.
// `uniqueKeys` a meaningful "how many of these were redundant" signal —
// the baseline issue #56's per-resource caching is meant to collapse.
// ---------------------------------------------------------------------------
const requestCounts = new Map<string, number>();
// Ordered log, so a benchmark can check sequencing (e.g. DKHP history before
// any timetable fetch for the same student). GET /_/log.
const requestLog: { key: string; student: string | null; t: number }[] = [];
function countRequest(key: string, student: string | null = null): void {
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  requestLog.push({ key, student, t: Date.now() });
}
function statsPayload() {
  const byKey = Object.fromEntries(requestCounts.entries());
  const total = [...requestCounts.values()].reduce((a, b) => a + b, 0);
  return { total, uniqueKeys: requestCounts.size, byKey };
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(body);
}

/** `dd/MM/yyyy` for a UTC-midnight-anchored date, matching the portal's format. */
function ddMmYyyy(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

/** Monday (UTC midnight) of ISO week `week` of `year` — inverse of `isoWeek()` in semester.ts. */
function mondayOfIsoWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7; // Sunday -> 7
  const week1Monday = new Date(jan4.getTime() - (jan4Weekday - 1) * DAY_MS);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * DAY_MS);
}

/** `namhoc` is `"2026-2027"`; ISO weeks 1-26 fall in the second calendar year. */
function calendarYearForWeek(academicYear: string, week: number): number {
  const startYear =
    Number(academicYear.split("-")[0]) || new Date().getUTCFullYear();
  return week <= 26 ? startYear + 1 : startYear;
}

// ---------------------------------------------------------------------------
// identity — which fixture student is this request for?
//
// Neither upstream's DATA request names a student: the portal identifies the
// caller by bearer token and Moodle by session cookie. Both are minted at login
// time (the one request that does carry a username), so both are made to carry
// the id so the per-student fixture files can be indexed.
// ---------------------------------------------------------------------------

const USE_FIXTURES = fixturesAvailable();

/** `StudentID` for a login username, or `null` if the fixtures don't know it. */
function studentIdForUsername(username: string): string | null {
  if (!USE_FIXTURES) return null;
  return (
    loadDluFixtures().studentIdByUsername.get(username.trim().toLowerCase()) ??
    null
  );
}

/**
 * The student behind a portal `Authorization: Bearer fake-portal-token-<id>`
 * (or `fake-dkhp-token-<id>` for the DKHP host).
 */
function studentIdFromAuthHeader(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+fake-(?:portal|dkhp)-token-(.+)$/i.exec(
    header.trim(),
  );
  const id = match?.[1];
  if (!id || !USE_FIXTURES) return null;
  return loadDluFixtures().byId.has(id) ? id : null;
}

/** The student behind a `MoodleSession=auth-<id>` cookie. */
function studentIdFromCookie(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie ?? "";
  const match = /MoodleSession[^=]*=auth-([^;]+)/.exec(cookie);
  const id = match?.[1];
  if (!id || !USE_FIXTURES) return null;
  return loadDluFixtures().byId.has(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Moodle LMS fakes
// ---------------------------------------------------------------------------

const COURSES = [
  { id: 101, fullname: "Cấu trúc dữ liệu và giải thuật", shortname: "CTDL" },
  { id: 102, fullname: "Cơ sở dữ liệu", shortname: "CSDL" },
  { id: 103, fullname: "Mạng máy tính", shortname: "MMT" },
];

function handleLoginGet(res: ServerResponse): void {
  countRequest("lms:login_form");
  res.setHeader(
    "set-cookie",
    `MoodleSession=anon-${Math.random().toString(36).slice(2)}; Path=/`,
  );
  sendHtml(
    res,
    200,
    `<html><body><form><input type="hidden" name="logintoken" value="tok-${Date.now()}"></form></body></html>`,
  );
}

async function handleLoginPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  countRequest("lms:login_submit");
  const raw = await readBody(req);
  const params = new URLSearchParams(raw);
  const password = params.get("password") ?? "";
  const username = params.get("username") ?? "";

  if (password === REJECT_PASSWORD) {
    sendHtml(
      res,
      200,
      `<html><body><div class="loginerror">Invalid login, please try again</div></body></html>`,
    );
    return;
  }

  // This is the only Moodle request that carries a username, so it is where the
  // student id gets baked into the session — everything downstream reads it back
  // off the cookie. An unknown username still logs in (a random suffix), and
  // that session simply falls through to the ad-hoc generator.
  const studentId = studentIdForUsername(username);
  const suffix = studentId ?? Math.random().toString(36).slice(2);
  res.setHeader("set-cookie", `MoodleSession=auth-${suffix}; Path=/`);
  res.writeHead(303, { location: "/my/" });
  res.end();
}

function handleMy(res: ServerResponse): void {
  countRequest("lms:my_sesskey");
  sendHtml(
    res,
    200,
    `<html><body><script>var M = {}; M.cfg = {"sesskey":"fakesesskey123","wwwroot":"http://localhost:${PORT}"};</script></body></html>`,
  );
}

interface FakeEvent {
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

let eventIdSeq = 1;

function makeEvent(base: Omit<FakeEvent, "id" | "timesort">): FakeEvent {
  return { id: eventIdSeq++, timesort: base.timestart, ...base };
}

/** Epoch seconds for UTC `year/month/day hour:00`, 1-based month. */
function epochSeconds(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour) / 1000);
}

/** The shared instance id a quiz split across `(year, month)` -> `(year, month+1)` uses. */
function splitQuizInstance(year: number, month: number): number {
  return 850_000 + year * 12 + month;
}

function buildMonthlyView(year: number, month: number): unknown {
  const course = COURSES[(year + month) % COURSES.length];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const events: FakeEvent[] = [];

  // Two assignment due dates.
  for (const [day, hour] of [
    [Math.min(15, daysInMonth), 23],
    [Math.min(25, daysInMonth), 23],
  ] as const) {
    const instance = 900_000 + year * 12 + month + day;
    events.push(
      makeEvent({
        name: `Bài tập lớn ${instance}`,
        modulename: "assign",
        instance,
        eventtype: "due",
        timestart: epochSeconds(year, month, day, hour),
        url: `http://localhost:${PORT}/mod/assign/view.php?id=${instance}`,
        description: "<p>Nộp bài qua LMS.</p>",
        course,
      }),
    );
  }

  // One same-month quiz (open + close within CONTIGUOUS_QUIZ_LIMIT_MINUTES).
  {
    const day = Math.min(10, daysInMonth);
    const instance = 800_000 + year * 12 + month;
    events.push(
      makeEvent({
        name: `Kiểm tra giữa kỳ mở`,
        modulename: "quiz",
        instance,
        eventtype: "open",
        timestart: epochSeconds(year, month, day, 7),
        url: `http://localhost:${PORT}/mod/quiz/view.php?id=${instance}`,
        description: "",
        course,
      }),
      makeEvent({
        name: `Kiểm tra giữa kỳ đóng`,
        modulename: "quiz",
        instance,
        eventtype: "close",
        timestart: epochSeconds(year, month, day, 9),
        url: `http://localhost:${PORT}/mod/quiz/view.php?id=${instance}`,
        description: "",
        course,
      }),
    );
  }

  // Split quiz: this month's `open`, near month end.
  {
    const instance = splitQuizInstance(year, month);
    events.push(
      makeEvent({
        name: `Quiz cuối kỳ mở`,
        modulename: "quiz",
        instance,
        eventtype: "open",
        timestart: epochSeconds(year, month, daysInMonth, 22),
        url: `http://localhost:${PORT}/mod/quiz/view.php?id=${instance}`,
        description: "",
        course,
      }),
    );
  }

  // Split quiz: last month's `open` closes on day 2 of THIS month.
  {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const instance = splitQuizInstance(prevYear, prevMonth);
    events.push(
      makeEvent({
        name: `Quiz cuối kỳ đóng`,
        modulename: "quiz",
        instance,
        eventtype: "close",
        timestart: epochSeconds(year, month, 2, 8),
        url: `http://localhost:${PORT}/mod/quiz/view.php?id=${instance}`,
        description: "",
        course,
      }),
    );
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return {
      events: events.filter(
        (e) => new Date(e.timestart * 1000).getUTCDate() === day,
      ),
    };
  });

  // One week of arbitrary length is fine — parse-lms.ts only flattens weeks/days/events.
  return { weeks: [{ days }] };
}

/**
 * Every Moodle AJAX method shares one path, so the method comes from the `info=`
 * query parameter. Two are implemented: the monthly calendar the watchers have
 * always used, and the enrolled-courses call issue #56's discovery added.
 */
async function handleAjaxService(
  req: IncomingMessage,
  res: ServerResponse,
  info: string,
): Promise<void> {
  const raw = await readBody(req);
  const studentId = studentIdFromCookie(req);

  if (info.includes("enrolled_courses")) {
    return handleEnrolledCourses(res, raw, studentId);
  }

  let year = new Date().getUTCFullYear();
  let month = new Date().getUTCMonth() + 1;
  try {
    const body = JSON.parse(raw) as {
      args?: { year?: number; month?: number };
    }[];
    year = body[0]?.args?.year ?? year;
    month = body[0]?.args?.month ?? month;
  } catch {
    // fall through with the defaults
  }

  // Counted by the addressed month, NOT by the raw URL: the URL carries a
  // per-login `sesskey`, so two logins asking for the same month would otherwise
  // look like two different resources and the redundancy ratio would be a lie.
  countRequest(`lms:calendar:${year}-${String(month).padStart(2, "0")}`);

  const data = studentId
    ? fixtureMonthlyView(studentId, year, month)
    : buildMonthlyView(year, month);
  sendJson(res, 200, [{ error: false, data }]);
}

/**
 * `core_course_get_enrolled_courses_by_timeline_classification`.
 *
 * Genuinely per-student, so its counter key is too — this is the *new* volume
 * discovery adds, and the measurement has to be able to separate it from the
 * term-scoped data requests it saves.
 *
 * Pages at 2 courses by default so the client's `nextoffset` loop is actually
 * exercised rather than always finishing in one request, and omits `nextoffset`
 * on the final page the way Moodle does.
 */
function handleEnrolledCourses(
  res: ServerResponse,
  raw: string,
  studentId: string | null,
): void {
  countRequest(`lms:enrolled:${studentId ?? "unknown"}`);

  let offset = 0;
  let limit = 0;
  try {
    const body = JSON.parse(raw) as {
      args?: { offset?: number; limit?: number };
    }[];
    offset = body[0]?.args?.offset ?? 0;
    limit = body[0]?.args?.limit ?? 0;
  } catch {
    // fall through with the defaults
  }
  const pageSize = limit > 0 ? limit : 2;

  const fixtures = USE_FIXTURES ? loadDluFixtures() : null;
  const courseIds = studentId
    ? (fixtures?.enrollments[studentId] ?? [])
    : COURSES.map((c) => c.id);

  const page = courseIds.slice(offset, offset + pageSize);
  const courses = page.map((id) => {
    const course = fixtures?.lmsCourses.get(id);
    return course
      ? {
          id: course.id,
          fullname: course.fullname,
          shortname: course.shortname,
          coursecategory: course.coursecategory,
          startdate: course.startdate,
          enddate: 0,
          visible: !course.hidden,
          hidden: course.hidden,
        }
      : {
          id,
          fullname:
            COURSES.find((c) => c.id === id)?.fullname ?? `Course ${id}`,
          shortname: COURSES.find((c) => c.id === id)?.shortname ?? `C${id}`,
          coursecategory: "Học kỳ 1",
          startdate: Math.floor(Date.now() / 1000),
          enddate: 0,
          visible: true,
          hidden: false,
        };
  });

  const nextOffset = offset + page.length;
  const hasMore = nextOffset < courseIds.length;
  sendJson(res, 200, [
    {
      error: false,
      data: { courses, ...(hasMore ? { nextoffset: nextOffset } : {}) },
    },
  ]);
}

/**
 * One month of a fixture student's calendar: the events of every course they are
 * enrolled in whose `timesort` falls in that month.
 *
 * Shaped as `{ weeks: [{ days: [{ events }] }] }` because that is all
 * `parse-lms.ts` reads — it flattens the grid and never looks at day numbers.
 */
function fixtureMonthlyView(
  studentId: string,
  year: number,
  month: number,
): { weeks: { days: { events: FixtureLmsEvent[] }[] }[] } {
  const fixtures = loadDluFixtures();
  const from = Date.UTC(year, month - 1, 1) / 1000;
  const to = Date.UTC(month === 12 ? year + 1 : year, month % 12, 1) / 1000;

  const events: FixtureLmsEvent[] = [];
  for (const courseId of fixtures.enrollments[studentId] ?? []) {
    for (const event of fixtures.eventsByCourse[String(courseId)] ?? []) {
      if (event.timesort >= from && event.timesort < to) events.push(event);
    }
  }
  return { weeks: [{ days: events.map((event) => ({ events: [event] })) }] };
}

// ---------------------------------------------------------------------------
// Portal API fakes
// ---------------------------------------------------------------------------

async function handleAuthenticate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Same path on both hosts; the client id says which one is asking.
  const isDkhp =
    String(req.headers.clientid ?? "").toLowerCase() === DKHP_CLIENT_ID;
  countRequest(isDkhp ? "dkhp:authenticate" : "portal:authenticate");
  if (isDkhp && !dkhpKeyOk(req)) {
    sendJson(res, 401, { message: "Invalid DKHP api key" });
    return;
  }
  const raw = await readBody(req);
  let password = "";
  let username = "";
  try {
    const body = JSON.parse(raw) as { password?: string; username?: string };
    password = body.password ?? "";
    username = body.username ?? "";
  } catch {
    // ignore — treated as a non-matching password below
  }

  if (password === REJECT_PASSWORD) {
    sendJson(res, 401, { message: "Invalid credentials" });
    return;
  }
  // Same trick as the Moodle cookie: the token is what every later portal call
  // carries, so it is where the student id has to live.
  const studentId = studentIdForUsername(username);
  sendJson(res, 200, {
    Token: `fake-${isDkhp ? "dkhp" : "portal"}-token-${studentId ?? Date.now()}`,
  });
}

/**
 * A fixture student's timetable for ISO week `tuan`.
 *
 * The fixtures hold ONE concrete reference week; a section meets at the same
 * weekday and periods every week, so any other week of the same term is the
 * reference week shifted by whole weeks. A different term has no fixture data
 * and answers `[]`, as the real portal does for a term the student is not in.
 *
 * `WeekScheduleID` is offset per week because the real portal mints one per
 * meeting — reusing the reference ids would make twenty weeks of meetings look
 * like one meeting moving around.
 */
function fixtureTimetableRows(
  studentId: string,
  namhoc: string,
  hocky: string,
  tuan: number,
): FixtureTimetableRow[] {
  const fixtures = loadDluFixtures();
  if (namhoc !== fixtures.referenceYear || hocky !== fixtures.referenceTerm) {
    return [];
  }
  const refMonday = mondayOfIsoWeek(
    calendarYearForWeek(namhoc, fixtures.referenceWeek),
    fixtures.referenceWeek,
  );
  const monday = mondayOfIsoWeek(calendarYearForWeek(namhoc, tuan), tuan);
  const shiftDays = Math.round(
    (monday.getTime() - refMonday.getTime()) / DAY_MS,
  );

  return (fixtures.timetableRows[studentId] ?? []).map((row) => {
    const [dd, mm, yyyy] = row.Ngay.split("/").map(Number);
    const date = new Date(Date.UTC(yyyy, mm - 1, dd + shiftDays));
    return {
      ...row,
      WeekScheduleID: row.WeekScheduleID + tuan * 10_000_000,
      Ngay: ddMmYyyy(date),
    };
  });
}

/**
 * `POST /api/student/getAllRegistHistory` — a fixture student's registration
 * events for one term, as the DKHP host answers: a flat log, cancellations and
 * re-registrations included. The parser, not this fake, decides what is current.
 */
function fixtureRegistHistory(
  studentId: string,
  year: string,
  term: string,
): unknown[] {
  const rows = (loadDluFixtures().registHistory[studentId] ?? []) as {
    YearStudy: string;
    TermID: string;
  }[];
  return rows.filter((row) => row.YearStudy === year && row.TermID === term);
}

/** Ad-hoc history: the three hardcoded sections, registered. */
function buildRegistHistory(year: string, term: string): unknown[] {
  return SECTIONS.map((section, i) => ({
    STT: i + 1,
    UpdateDate: `2026-06-09 09:50:${String(10 + i).padStart(2, "0")}`,
    Task: "Đăng ký",
    Info: `${section.unitId} [${section.name}]`,
    UpdateStaff: "ADHOC",
    CurriculumName: `${section.name} ()`,
    CurriculumID: section.unitId,
    Status: 1,
    Credits: 3,
    YearStudy: year,
    TermID: term,
    Lydo: "",
  }));
}

const SECTIONS = [
  {
    unitId: "SU-CTDL-01",
    name: "Cấu trúc dữ liệu và giải thuật",
    teacher: "Nguyễn Văn A",
    room: "A101",
    building: "Nhà A",
    campus: "Cơ sở 1",
  },
  {
    unitId: "SU-CSDL-02",
    name: "Cơ sở dữ liệu",
    teacher: "Trần Thị B",
    room: "B204",
    building: "Nhà B",
    campus: "Cơ sở 1",
  },
  {
    unitId: "SU-MMT-01",
    name: "Mạng máy tính",
    teacher: "Lê Văn C",
    room: "C305",
    building: "Nhà C",
    campus: "Cơ sở 2",
  },
];

/** Lecture blocks: Mon periods 1-4, Wed periods 7-10, Fri periods 11-14. */
const TIMETABLE_SLOTS = [
  { weekdayOffset: 0, periodId: 1, numberOfPeriods: 4 },
  { weekdayOffset: 2, periodId: 7, numberOfPeriods: 4 },
  { weekdayOffset: 4, periodId: 11, numberOfPeriods: 4 },
];

function buildTimetableRows(
  namhoc: string,
  hocky: string,
  tuan: number,
): unknown[] {
  const year = calendarYearForWeek(namhoc, tuan);
  const monday = mondayOfIsoWeek(year, tuan);

  return TIMETABLE_SLOTS.map((slot, i) => {
    const section = SECTIONS[i % SECTIONS.length];
    const date = new Date(monday.getTime() + slot.weekdayOffset * DAY_MS);
    return {
      WeekScheduleID: `${namhoc}-${hocky}-${tuan}-${i}`,
      ScheduleStudyUnitID: section.unitId,
      CurriculumName: section.name,
      PeriodID: slot.periodId,
      NumberOfPeriods: slot.numberOfPeriods,
      Ngay: ddMmYyyy(date),
      RoomID: section.room,
      BuildingName: section.building,
      CampusName: section.campus,
      FullName: section.teacher,
      YearStudy: namhoc,
      TermID: hocky,
      TKHHienThi: `<span>${section.name} (${section.unitId})</span><br/><span>- Nhóm: 01</span><br/>`,
    };
  });
}

function buildExamRows(): unknown[] {
  const today = new Date();
  return SECTIONS.map((section, i) => {
    const date = new Date(today.getTime() + (10 + i * 10) * DAY_MS);
    return {
      Examination: 700_000 + i,
      ScheduleStudyUnitID: section.unitId,
      CurriculumID: section.unitId,
      CurriculumName: section.name,
      NgayThi: ddMmYyyy(date),
      GioThi: i % 2 === 0 ? "07g30" : "13g00",
      ThoiLuong: String(60 + i * 30),
      PhongThi: section.room,
      DiaDiem: section.building,
      HinhThucThi: i % 2 === 0 ? "Tự luận" : "Thi máy",
    };
  });
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const { pathname, searchParams } = url;

    try {
      if (pathname === "/_/stats" && req.method === "GET") {
        return sendJson(res, 200, statsPayload());
      }
      if (pathname === "/_/log" && req.method === "GET") {
        return sendJson(res, 200, requestLog);
      }
      if (pathname === "/_/reload-fixtures" && req.method === "POST") {
        resetDluFixtureCache();
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === "/_/reset" && req.method === "POST") {
        requestCounts.clear();
        requestLog.length = 0;
        return sendJson(res, 200, { ok: true });
      }
      if (LATENCY_MS > 0 || JITTER_MS > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, LATENCY_MS + Math.random() * JITTER_MS),
        );
      }
      if (pathname === "/login/index.php" && req.method === "GET") {
        return handleLoginGet(res);
      }
      if (pathname === "/login/index.php" && req.method === "POST") {
        return await handleLoginPost(req, res);
      }
      if (pathname === "/my/" && req.method === "GET") {
        return handleMy(res);
      }
      if (pathname === "/lib/ajax/service.php" && req.method === "POST") {
        return await handleAjaxService(
          req,
          res,
          searchParams.get("info") ?? "",
        );
      }
      if (pathname === "/api/authenticate/authpsc" && req.method === "POST") {
        return await handleAuthenticate(req, res);
      }
      if (
        pathname === "/api/student/DrawingStudentSchedules" &&
        req.method === "GET"
      ) {
        const namhoc = searchParams.get("namhoc") ?? "2026-2027";
        const hocky = searchParams.get("hocky") ?? "HK01";
        const tuan = Number(searchParams.get("tuan") ?? "1");
        countRequest(
          `portal:timetable:${namhoc}:${hocky}:w${tuan}`,
          studentIdFromAuthHeader(req),
        );
        const studentId = studentIdFromAuthHeader(req);
        return sendJson(
          res,
          200,
          studentId
            ? fixtureTimetableRows(studentId, namhoc, hocky, tuan)
            : buildTimetableRows(namhoc, hocky, tuan),
        );
      }
      if (pathname === "/api/student/exam" && req.method === "GET") {
        const namhoc = searchParams.get("namhoc") ?? "2026-2027";
        const hocky = searchParams.get("hocky") ?? "HK01";
        countRequest(`portal:exam:${namhoc}:${hocky}`, studentIdFromAuthHeader(req));
        const studentId = studentIdFromAuthHeader(req);
        const fixtures = studentId ? loadDluFixtures() : null;
        return sendJson(
          res,
          200,
          studentId && fixtures
            ? namhoc === fixtures.referenceYear &&
              hocky === fixtures.referenceTerm
              ? (fixtures.examRows[studentId] ?? [])
              : []
            : buildExamRows(),
        );
      }
      // Discovery (issue #56): DKHP's registration history. Per-student by
      // nature, so — like `lms:enrolled` — its counter key names the student:
      // this is the volume discovery ADDS, kept separable from the term-scoped
      // volume it saves.
      if (
        pathname === "/api/student/getAllRegistHistory" &&
        req.method === "POST"
      ) {
        if (
          String(req.headers.clientid ?? "").toLowerCase() !== DKHP_CLIENT_ID ||
          !dkhpKeyOk(req)
        ) {
          return sendJson(res, 401, { message: "Invalid DKHP client or key" });
        }
        let year = "";
        let term = "";
        try {
          const body = JSON.parse(await readBody(req)) as {
            p1?: string;
            p2?: string;
          };
          year = body.p1 ?? "";
          term = body.p2 ?? "";
        } catch {
          return sendJson(res, 400, { message: "invalid body" });
        }
        const studentId = studentIdFromAuthHeader(req);
        countRequest(
          `dkhp:history:${year}:${term}:${studentId ?? "unknown"}`,
          studentId,
        );
        return sendJson(
          res,
          200,
          studentId
            ? fixtureRegistHistory(studentId, year, term)
            : buildRegistHistory(year, term),
        );
      }

      sendJson(res, 404, {
        message: `no fake route for ${req.method} ${pathname}`,
      });
    } catch (err) {
      sendJson(res, 500, { message: (err as Error).message });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`Fake LMS + portal server listening on http://localhost:${PORT}`);
  console.log(`  LMS_URL="http://localhost:${PORT}"`);
  console.log(`  PORTAL_API_URL="http://localhost:${PORT}"`);
  console.log(`  PORTAL_API_KEY can be anything — never checked`);
  console.log(`  DKHP_API_URL="http://localhost:${PORT}"`);
  console.log(
    DKHP_API_KEY
      ? `  DKHP_API_KEY must be "${DKHP_API_KEY}"`
      : `  DKHP_API_KEY can be any non-empty value`,
  );
  if (LATENCY_MS > 0) console.log(`  latency: ${LATENCY_MS}ms per request`);
  console.log(
    `  password "wrongpass" -> INVALID_CREDENTIALS on both endpoints`,
  );
});
