import {
  CONTIGUOUS_QUIZ_LIMIT_MINUTES,
  type MoodleCalendarEvent,
  type MoodleMonthlyView,
  parseMonthlyView,
} from "./parse-lms";

/**
 * Fixtures below are the real captured payloads, trimmed to the fields the
 * parser reads but with every value left exactly as DLU returned it:
 *  - the two assignments and the `attendance` event from `INTEGRATION_DOCS.md`
 *    (`core_calendar_get_calendar_monthly_view`, April 2026);
 *  - the 50-minute quiz open/close pair from `quiz_lms.json` (October 2024),
 *    whose two events share instance 800004 but have ids 700004 / 700005.
 */

const COURSE_90002 = {
  id: 90002,
  fullname: "Môn học Mẫu Ba - MHK99PM",
  shortname: "Môn học Mẫu Ba - MHK99PM",
};
const COURSE_90001 = {
  id: 90001,
  fullname: "Môn học Mẫu Hai - MHK99PM",
  shortname: "10AB1002_MHK99PM",
};
const COURSE_90003 = {
  id: 90003,
  fullname: "TUẦN LỄ MẪU (MHK99A, MHK99B, MHK99C)",
  shortname: "TUẦN LỄ MẪU (MHK99A, MHK99B, MHK99C)",
};

/** `assign` / `due` — 2026-04-01 07:39 VN (00:39 UTC). */
const ASSIGN_DUE_0739: MoodleCalendarEvent = {
  id: 700001,
  name: "Bài tập Mẫu 01 đến hạn",
  location: "",
  modulename: "assign",
  instance: 800001,
  eventtype: "due",
  timestart: 1775003940,
  timesort: 1775003940,
  course: COURSE_90002,
};

/** `attendance` — must never reach the calendar. */
const ATTENDANCE: MoodleCalendarEvent = {
  id: 700002,
  name: "Điểm danh",
  location: "",
  modulename: "attendance",
  instance: 800003,
  eventtype: "attendance",
  timestart: 1775177100,
  timesort: 1775177100,
  course: COURSE_90001,
};

/** `assign` / `due` — 2026-04-03 23:59 VN (16:59 UTC). */
const ASSIGN_DUE_2359: MoodleCalendarEvent = {
  id: 700003,
  name: "Bài thực hành Mẫu 07 đến hạn",
  location: "",
  modulename: "assign",
  instance: 800002,
  eventtype: "due",
  timestart: 1775235540,
  timesort: 1775235540,
  course: COURSE_90001,
};

/** The real quiz pair — 50-minute window, one instance, two event ids. */
const QUIZ_OPEN: MoodleCalendarEvent = {
  id: 700004,
  name: "BÀI THU HOẠCH MẪU mở",
  location: "",
  modulename: "quiz",
  instance: 800004,
  eventtype: "open",
  timestart: 1729852500,
  timesort: 1729852500,
  course: COURSE_90003,
};

const QUIZ_CLOSE: MoodleCalendarEvent = {
  id: 700005,
  name: "BÀI THU HOẠCH MẪU đóng",
  location: "",
  modulename: "quiz",
  instance: 800004,
  eventtype: "close",
  timestart: 1729855500,
  timesort: 1729855500,
  course: COURSE_90003,
};

/** Wrap events in the weeks → days → events shape Moodle returns. */
const view = (...days: MoodleCalendarEvent[][]): MoodleMonthlyView => ({
  weeks: [{ days: days.map((events) => ({ events })) }],
});

/** Well before every fixture instant. */
const BEFORE_ALL = new Date("2024-01-01T00:00:00.000Z");

describe("parseMonthlyView — filtering", () => {
  it("keeps assign/quiz and drops attendance", () => {
    const { items } = parseMonthlyView(
      view([ASSIGN_DUE_0739], [ATTENDANCE, ASSIGN_DUE_2359]),
      BEFORE_ALL,
    );

    expect(items.map((i) => i.externalKey)).toEqual([
      "lms:assign:800001",
      "lms:assign:800002",
    ]);
    expect(items.every((i) => !i.externalKey.includes("800003"))).toBe(true);
  });

  it("drops events at or before `now` and keeps the rest", () => {
    // Between the two assignments: 2026-04-02.
    const now = new Date("2026-04-02T00:00:00.000Z");
    const { items } = parseMonthlyView(
      view([ASSIGN_DUE_0739, ASSIGN_DUE_2359]),
      now,
    );

    expect(items.map((i) => i.externalKey)).toEqual(["lms:assign:800002"]);
  });

  it("treats `now` exactly on the sort time as past", () => {
    const now = new Date(1775003940 * 1000);
    expect(parseMonthlyView(view([ASSIGN_DUE_0739]), now).items).toEqual([]);
  });

  it("tolerates an empty or malformed payload", () => {
    expect(parseMonthlyView(undefined, BEFORE_ALL)).toEqual({
      items: [],
      courses: [],
      skipped: [],
    });
    expect(parseMonthlyView({ weeks: [] }, BEFORE_ALL).items).toEqual([]);
    expect(
      parseMonthlyView({ weeks: [{ days: [{ events: null }] }] }, BEFORE_ALL)
        .items,
    ).toEqual([]);
  });
});

describe("parseMonthlyView — assignments", () => {
  it("blocks the 15 minutes ending at the deadline's slot", () => {
    const { items } = parseMonthlyView(view([ASSIGN_DUE_0739]), BEFORE_ALL);

    // Due 00:39 UTC → the slot boundary below is 00:30 → block 00:15–00:30.
    expect(items).toEqual([
      {
        externalKey: "lms:assign:800001",
        title: "Bài tập Mẫu 01 đến hạn",
        type: "ASSIGNMENT",
        scheduledStartTime: new Date("2026-04-01T00:15:00.000Z"),
        durationMinutes: 15,
        location: null,
        note: null,
        lmsCourse: {
          lmsCourseId: 90002,
          fullName: COURSE_90002.fullname,
          shortName: COURSE_90002.shortname,
        },
      },
    ]);
  });

  it("handles an 11:59 PM deadline (16:59 UTC → 16:30–16:45)", () => {
    const [item] = parseMonthlyView(view([ASSIGN_DUE_2359]), BEFORE_ALL).items;

    expect(item.scheduledStartTime).toEqual(
      new Date("2026-04-03T16:30:00.000Z"),
    );
    expect(item.durationMinutes).toBe(15);
  });

  it("keys on `instance`, never on the event id", () => {
    const [item] = parseMonthlyView(view([ASSIGN_DUE_0739]), BEFORE_ALL).items;
    expect(item.externalKey).toBe("lms:assign:800001");
    expect(item.externalKey).not.toContain("700001");
  });
});

describe("parseMonthlyView — quizzes", () => {
  it("pairs open/close by instance into one contiguous 50-minute window", () => {
    const { items, skipped } = parseMonthlyView(
      view([QUIZ_OPEN, QUIZ_CLOSE]),
      BEFORE_ALL,
    );

    expect(skipped).toEqual([]);
    expect(items).toEqual([
      {
        externalKey: "lms:quiz:800004",
        title: "BÀI THU HOẠCH MẪU",
        type: "EXAM",
        // 17:35–18:25 VN, widened onto the grid to 17:30–18:30.
        scheduledStartTime: new Date("2024-10-25T10:30:00.000Z"),
        durationMinutes: 60,
        location: null,
        note: null,
        lmsCourse: {
          lmsCourseId: 90003,
          fullName: COURSE_90003.fullname,
          shortName: COURSE_90003.shortname,
        },
      },
    ]);
  });

  it("pairs them even when they land on different days of the grid", () => {
    const { items } = parseMonthlyView(
      view([QUIZ_OPEN], [QUIZ_CLOSE]),
      BEFORE_ALL,
    );
    expect(items).toHaveLength(1);
    expect(items[0].durationMinutes).toBe(60);
  });

  it("degrades a window longer than 200 minutes to a reminder before the close", () => {
    const openAt = 1729852500;
    const closeAt = openAt + (CONTIGUOUS_QUIZ_LIMIT_MINUTES + 1) * 60;
    const { items } = parseMonthlyView(
      view([
        { ...QUIZ_OPEN, timestart: openAt, timesort: openAt },
        { ...QUIZ_CLOSE, timestart: closeAt, timesort: closeAt },
      ]),
      BEFORE_ALL,
    );

    expect(items[0].durationMinutes).toBe(15);
    // close = 10:35 + 201 min = 13:56 UTC → slot boundary 13:45 → 13:30–13:45.
    expect(items[0].scheduledStartTime).toEqual(
      new Date("2024-10-25T13:30:00.000Z"),
    );
  });

  it("keeps a window of exactly 200 minutes contiguous", () => {
    const openAt = 1729852500;
    const closeAt = openAt + CONTIGUOUS_QUIZ_LIMIT_MINUTES * 60;
    const { items } = parseMonthlyView(
      view([
        { ...QUIZ_OPEN, timestart: openAt, timesort: openAt },
        { ...QUIZ_CLOSE, timestart: closeAt, timesort: closeAt },
      ]),
      BEFORE_ALL,
    );

    expect(items[0].durationMinutes).toBe(210); // 10:35–13:55 snapped to 10:30–14:00
  });

  it("treats a lone close as a deadline", () => {
    const { items, skipped } = parseMonthlyView(view([QUIZ_CLOSE]), BEFORE_ALL);

    expect(skipped).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].durationMinutes).toBe(15);
    // Close 11:25 UTC → slot boundary 11:15 → block 11:00–11:15.
    expect(items[0].scheduledStartTime).toEqual(
      new Date("2024-10-25T11:00:00.000Z"),
    );
  });

  it("skips a lone open and says why", () => {
    const { items, skipped } = parseMonthlyView(view([QUIZ_OPEN]), BEFORE_ALL);

    expect(items).toEqual([]);
    expect(skipped).toEqual([
      {
        ref: "lms:quiz:800004",
        reason:
          "quiz open event without its close (expected in the next month's fetch)",
      },
    ]);
  });

  it("skips a lone open even when it also emits the course", () => {
    const { courses } = parseMonthlyView(view([QUIZ_OPEN]), BEFORE_ALL);
    expect(courses).toEqual([
      {
        lmsCourseId: 90003,
        fullName: COURSE_90003.fullname,
        shortName: COURSE_90003.shortname,
      },
    ]);
  });
});

describe("parseMonthlyView — courses", () => {
  it("returns each distinct course once", () => {
    const { courses } = parseMonthlyView(
      view(
        [ASSIGN_DUE_0739, ATTENDANCE],
        [ASSIGN_DUE_2359, QUIZ_OPEN, QUIZ_CLOSE],
      ),
      BEFORE_ALL,
    );

    expect(courses).toEqual([
      {
        lmsCourseId: 90002,
        fullName: COURSE_90002.fullname,
        shortName: COURSE_90002.shortname,
      },
      {
        lmsCourseId: 90001,
        fullName: COURSE_90001.fullname,
        shortName: "10AB1002_MHK99PM",
      },
      {
        lmsCourseId: 90003,
        fullName: COURSE_90003.fullname,
        shortName: COURSE_90003.shortname,
      },
    ]);
  });

  it("does not report a course whose only events were attendance", () => {
    const { courses } = parseMonthlyView(view([ATTENDANCE]), BEFORE_ALL);
    expect(courses).toEqual([]);
  });
});
