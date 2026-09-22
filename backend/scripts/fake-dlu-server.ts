/**
 * Fake DLU LMS (Moodle) + student-portal server, for exercising the ingestion
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
 *
 * Any username/password logs in on both endpoints. To exercise the
 * `INVALID_CREDENTIALS` path (`LMSService.login` / `PortalAPIService.authenticate`),
 * use the password "wrongpass" — both fake endpoints reject it the way the
 * real ones do (Moodle re-renders the login form; the portal answers 401).
 *
 * Data is generated fresh per request, anchored on the real wall clock, so
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

const PORT = Number(process.env.FAKE_DLU_PORT ?? 4100);
const REJECT_PASSWORD = "wrongpass";
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
function countRequest(key: string): void {
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
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

  if (password === REJECT_PASSWORD) {
    sendHtml(
      res,
      200,
      `<html><body><div class="loginerror">Invalid login, please try again</div></body></html>`,
    );
    return;
  }

  res.setHeader(
    "set-cookie",
    `MoodleSession=auth-${Math.random().toString(36).slice(2)}; Path=/`,
  );
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

async function handleAjaxService(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const raw = await readBody(req);
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
  countRequest(`lms:calendar:${year}-${String(month).padStart(2, "0")}`);
  sendJson(res, 200, [{ error: false, data: buildMonthlyView(year, month) }]);
}

// ---------------------------------------------------------------------------
// Portal API fakes
// ---------------------------------------------------------------------------

async function handleAuthenticate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  countRequest("portal:authenticate");
  const raw = await readBody(req);
  let password = "";
  try {
    password = (JSON.parse(raw) as { password?: string }).password ?? "";
  } catch {
    // ignore — treated as a non-matching password below
  }

  if (password === REJECT_PASSWORD) {
    sendJson(res, 401, { message: "Invalid credentials" });
    return;
  }
  sendJson(res, 200, { Token: `fake-portal-token-${Date.now()}` });
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
      if (pathname === "/_/reset" && req.method === "POST") {
        requestCounts.clear();
        return sendJson(res, 200, { ok: true });
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
        return await handleAjaxService(req, res);
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
        countRequest(`portal:timetable:${namhoc}:${hocky}:w${tuan}`);
        return sendJson(res, 200, buildTimetableRows(namhoc, hocky, tuan));
      }
      if (pathname === "/api/student/exam" && req.method === "GET") {
        const namhoc = searchParams.get("namhoc") ?? "2026-2027";
        const hocky = searchParams.get("hocky") ?? "HK01";
        countRequest(`portal:exam:${namhoc}:${hocky}`);
        return sendJson(res, 200, buildExamRows());
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
  console.log(
    `Fake DLU LMS + portal server listening on http://localhost:${PORT}`,
  );
  console.log(`  LMS_URL="http://localhost:${PORT}"`);
  console.log(`  PORTAL_API_URL="http://localhost:${PORT}"`);
  console.log(`  PORTAL_API_KEY can be anything — never checked`);
  console.log(
    `  password "wrongpass" -> INVALID_CREDENTIALS on both endpoints`,
  );
});
