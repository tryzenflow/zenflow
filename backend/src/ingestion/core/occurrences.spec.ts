import {
  blocksFromLmsOccurrences,
  blocksFromPortalOccurrences,
  isCoverageFresh,
  lectureNote,
  lmsFingerprint,
  lmsOccurrenceChanged,
  observeUnit,
  occurrencesFromLms,
  occurrencesFromTimetable,
  portalOccurrenceChanged,
  type LmsOccurrenceInput,
  type PortalOccurrenceInput,
  type UnitAgreement,
} from "./occurrences";
import { parseTimetable } from "./parse-portal";
import type { ParsedLmsItem } from "./types";

const VN = "Asia/Ho_Chi_Minh";
const COORDS = { isoWeek: 44, yearStudy: "2026-2027", termId: "HK01" };
const NOW = new Date("2026-10-26T03:00:00.000Z");
const DAY = 24 * 60 * 60_000;

// Deliberately fictional, in the shape the real parsers consume.
const LECTURE_ROW = {
  CurriculumName: "Môn học Mẫu Một",
  WeekScheduleID: 900000001,
  ScheduleStudyUnitID: "99910AB100101",
  PeriodID: 1,
  NumberOfPeriods: 4,
  Ngay: "26/10/2026",
  RoomID: "X01.01",
  CampusName: "CSMAU",
  FullName: "Nguyễn Văn A",
  BuildingName: "A27",
  YearStudy: "2026-2027",
  TermID: "HK01",
  TKHHienThi: "<span>Môn học Mẫu Một (10AB1001)</span><br/>",
};

describe("the walk -> cache -> block round trip", () => {
  // The property the whole cache rests on. A block rebuilt from cache goes to
  // the SAME materializer a live walk feeds, so any difference in a compared
  // field would manufacture a phantom "upstream change" and notify every
  // student about it on every pass.

  it("rebuilds a lecture block identical to the one the walk produced", () => {
    const walked = parseTimetable([LECTURE_ROW], VN).items;
    const rebuilt = blocksFromPortalOccurrences(
      occurrencesFromTimetable(walked, COORDS),
    );

    expect(rebuilt).toHaveLength(1);
    // legacyExternalKey is the one deliberate difference: WeekScheduleID is
    // per-student, so a cached row cannot know it.
    expect({ ...rebuilt[0], legacyExternalKey: undefined }).toEqual({
      ...walked[0],
      legacyExternalKey: undefined,
    });
  });

  it("gives the rebuilt lecture the same externalKey as the walk", () => {
    const walked = parseTimetable([LECTURE_ROW], VN).items;
    const rebuilt = blocksFromPortalOccurrences(
      occurrencesFromTimetable(walked, COORDS),
    );
    expect(rebuilt[0].externalKey).toBe(walked[0].externalKey);
    expect(rebuilt[0].externalKey).toBe(
      "portal:lecture:99910AB100101:2026-10-26:1",
    );
  });

  it("rebuilds a lecture from a DIFFERENT student's walk to the same key", () => {
    // The entire point: one student's walk warms the cache for the cohort.
    const mine = parseTimetable([LECTURE_ROW], VN).items;
    const theirs = parseTimetable(
      [{ ...LECTURE_ROW, WeekScheduleID: 900009999 }],
      VN,
    ).items;

    const fromTheirs = blocksFromPortalOccurrences(
      occurrencesFromTimetable(theirs, COORDS),
    );
    expect(fromTheirs[0].externalKey).toBe(mine[0].externalKey);
  });

  it("round-trips the teacher through the note without corrupting it", () => {
    const walked = parseTimetable([LECTURE_ROW], VN).items;
    const cached = occurrencesFromTimetable(walked, COORDS);
    expect(cached[0].teacherName).toBe("Nguyễn Văn A");
    expect(blocksFromPortalOccurrences(cached)[0].note).toBe(
      "GV: Nguyễn Văn A",
    );
  });

  it("round-trips a lecture with no teacher as a null note", () => {
    const walked = parseTimetable(
      [{ ...LECTURE_ROW, FullName: null }],
      VN,
    ).items;
    const cached = occurrencesFromTimetable(walked, COORDS);
    expect(cached[0].teacherName).toBeNull();
    expect(blocksFromPortalOccurrences(cached)[0].note).toBeNull();
  });

  it("rebuilds an LMS block, course tag included", () => {
    const walked: ParsedLmsItem[] = [
      {
        externalKey: "lms:assign:500123",
        title: "Bài tập 1",
        type: "ASSIGNMENT",
        scheduledStartTime: new Date("2026-11-01T16:00:00.000Z"),
        durationMinutes: 15,
        location: "https://lms.example.test/mod/assign/view.php?id=1",
        note: "<p>Nộp bài</p>",
        lmsCourse: {
          lmsCourseId: 20001,
          fullName: "Môn học Mẫu Một",
          shortName: "TESTCUR-IT-101",
        },
      },
    ];

    const cached = occurrencesFromLms(walked);
    const rebuilt = blocksFromLmsOccurrences(
      cached,
      new Map([
        [20001, { fullName: "Môn học Mẫu Một", shortName: "TESTCUR-IT-101" }],
      ]),
    );

    // The course's fullName becomes a tag on the session, so losing it here
    // would silently give a cache-served student an untagged session.
    expect(rebuilt).toEqual(walked);
  });

  it("drops an LMS item whose event carried no course", () => {
    // Nothing to key it under, so it cannot be shared with anyone.
    const cached = occurrencesFromLms([
      {
        externalKey: "lms:quiz:800123",
        title: "Quiz",
        type: "EXAM",
        scheduledStartTime: NOW,
        durationMinutes: 60,
        location: null,
        note: null,
        lmsCourse: null,
      },
    ]);
    expect(cached).toEqual([]);
  });

  it("carries the walk's academic coordinates onto the cache row", () => {
    const walked = parseTimetable([LECTURE_ROW], VN).items;
    const cached = occurrencesFromTimetable(walked, COORDS);
    expect(cached[0]).toMatchObject({
      isoWeek: 44,
      yearStudy: "2026-2027",
      termId: "HK01",
      periodId: 1,
      numberOfPeriods: 4,
      meetingDate: "2026-10-26",
    });
  });

  it("keeps two meetings of one section on one day apart through the round trip", () => {
    const walked = parseTimetable(
      [LECTURE_ROW, { ...LECTURE_ROW, WeekScheduleID: 2, PeriodID: 7 }],
      VN,
    ).items;
    const rebuilt = blocksFromPortalOccurrences(
      occurrencesFromTimetable(walked, COORDS),
    );
    expect(new Set(rebuilt.map((b) => b.externalKey)).size).toBe(2);
  });
});

describe("isCoverageFresh", () => {
  const MAX_AGE = 90_000;

  it("is not usable when nothing has ever been read", () => {
    expect(isCoverageFresh({ refreshedAt: null }, NOW, MAX_AGE)).toBe(false);
    expect(isCoverageFresh({ refreshedAt: undefined }, NOW, MAX_AGE)).toBe(
      false,
    );
  });

  it("is usable inside the window and not past it", () => {
    expect(
      isCoverageFresh(
        { refreshedAt: new Date(NOW.getTime() - MAX_AGE) },
        NOW,
        MAX_AGE,
      ),
    ).toBe(true);
    expect(
      isCoverageFresh(
        { refreshedAt: new Date(NOW.getTime() - MAX_AGE - 1) },
        NOW,
        MAX_AGE,
      ),
    ).toBe(false);
  });

  it("is not usable when the covered window stops short, however recent the read", () => {
    // The condition an aggregate over occurrence rows could not express: a
    // section read a minute ago by a walk that only reached last Friday would
    // silently truncate a student looking at next month.
    const required = new Date("2026-12-20T00:00:00.000Z");
    expect(
      isCoverageFresh(
        {
          refreshedAt: new Date(NOW.getTime() - 60_000),
          throughDate: new Date("2026-10-30T00:00:00.000Z"),
        },
        NOW,
        MAX_AGE,
        required,
      ),
    ).toBe(false);
  });

  it("is usable when the covered window reaches exactly far enough", () => {
    const required = new Date("2026-12-20T00:00:00.000Z");
    expect(
      isCoverageFresh(
        { refreshedAt: NOW, throughDate: required },
        NOW,
        MAX_AGE,
        required,
      ),
    ).toBe(true);
  });

  it("is not usable when a window is required but none was recorded", () => {
    expect(
      isCoverageFresh(
        { refreshedAt: NOW, throughDate: null },
        NOW,
        MAX_AGE,
        NOW,
      ),
    ).toBe(false);
  });

  it("ignores the window when none is required", () => {
    expect(
      isCoverageFresh({ refreshedAt: NOW, throughDate: null }, NOW, MAX_AGE),
    ).toBe(true);
  });
});

describe("change detection", () => {
  function occurrence(
    over: Partial<PortalOccurrenceInput> = {},
  ): PortalOccurrenceInput {
    return {
      scheduleStudyUnitId: "99910AB100101",
      meetingDate: "2026-10-26",
      periodId: 1,
      numberOfPeriods: 4,
      isoWeek: 44,
      yearStudy: "2026-2027",
      termId: "HK01",
      startsAt: new Date("2026-10-26T00:30:00.000Z"),
      durationMinutes: 225,
      title: "Môn học Mẫu Một",
      roomId: "X01.01",
      teacherName: "Nguyễn Văn A",
      ...over,
    };
  }

  it("sees no change when only bookkeeping moved", () => {
    // Bumping lastSeenAt / isoWeek on every pass must not read as a room change
    // to every classmate.
    const existing = occurrence();
    expect(portalOccurrenceChanged(existing, occurrence({ isoWeek: 45 }))).toBe(
      false,
    );
  });

  it("sees a room swap, a time move, a rename and a teacher change", () => {
    const existing = occurrence();
    expect(
      portalOccurrenceChanged(existing, occurrence({ roomId: "X09.09" })),
    ).toBe(true);
    expect(
      portalOccurrenceChanged(
        existing,
        occurrence({ startsAt: new Date("2026-10-26T06:00:00.000Z") }),
      ),
    ).toBe(true);
    expect(
      portalOccurrenceChanged(existing, occurrence({ title: "Khác" })),
    ).toBe(true);
    expect(
      portalOccurrenceChanged(existing, occurrence({ teacherName: "Trần B" })),
    ).toBe(true);
    expect(
      portalOccurrenceChanged(existing, occurrence({ durationMinutes: 180 })),
    ).toBe(true);
  });

  it("sees an LMS deadline move and a description change", () => {
    const existing = {
      startsAt: NOW,
      durationMinutes: 15,
      title: "Bài tập 1",
      note: "<p>a</p>",
      location: "https://x",
    };
    const base = {
      lmsCourseId: 20001,
      externalKey: "lms:assign:1",
      type: "ASSIGNMENT" as const,
      ...existing,
    };
    expect(lmsOccurrenceChanged(existing, base)).toBe(false);
    expect(
      lmsOccurrenceChanged(existing, {
        ...base,
        startsAt: new Date(NOW.getTime() + DAY),
      }),
    ).toBe(true);
    expect(lmsOccurrenceChanged(existing, { ...base, note: "<p>b</p>" })).toBe(
      true,
    );
  });
});

describe("lectureNote", () => {
  it("prefixes a teacher and yields null for none", () => {
    expect(lectureNote("Nguyễn Văn A")).toBe("GV: Nguyễn Văn A");
    expect(lectureNote(null)).toBeNull();
  });
});

describe("fingerprints", () => {
  const QUIZ: LmsOccurrenceInput = {
    lmsCourseId: 90001,
    externalKey: "lms:quiz:520001",
    type: "EXAM",
    startsAt: new Date("2026-10-20T01:00:00.000Z"),
    durationMinutes: 60,
    title: "Quiz 1",
    note: null,
    location: null,
  };
  const ASSIGN: LmsOccurrenceInput = {
    ...QUIZ,
    externalKey: "lms:assign:520002",
    type: "ASSIGNMENT",
    title: "Assignment 1",
  };

  it("ignores row order", () => {
    expect(lmsFingerprint("m", [QUIZ, ASSIGN])).toBe(
      lmsFingerprint("m", [ASSIGN, QUIZ]),
    );
  });

  it("changes when anything a student would see changes", () => {
    // A room swap, a moved due date, a retitled activity — each must break
    // equality, or a changed view would be served as the unchanged one.
    expect(
      lmsFingerprint("m", [
        { ...QUIZ, startsAt: new Date("2026-10-21T01:00:00.000Z") },
      ]),
    ).not.toBe(lmsFingerprint("m", [QUIZ]));
    expect(lmsFingerprint("m", [{ ...QUIZ, title: "Quiz 1b" }])).not.toBe(
      lmsFingerprint("m", [QUIZ]),
    );
  });

  it("sees an activity that is missing, not just one that differs", () => {
    // The group-restricted case: another student's view simply lacks it.
    expect(lmsFingerprint("m", [QUIZ])).not.toBe(
      lmsFingerprint("m", [QUIZ, ASSIGN]),
    );
  });

  it("never equates views of different windows", () => {
    expect(lmsFingerprint("2026-10,2026-11", [])).not.toBe(
      lmsFingerprint("2026-11,2026-12", []),
    );
  });

  it("gives an empty view a stable fingerprint of its own", () => {
    // A course with no activity yet is a real, comparable view — not "unknown".
    expect(lmsFingerprint("m", [])).toBe(lmsFingerprint("m", []));
    expect(lmsFingerprint("m", [])).not.toBe(lmsFingerprint("m", [QUIZ]));
  });
});

describe("observeUnit — the fan-out agreement state machine", () => {
  const EMPTY: UnitAgreement = { fingerprint: null, by: null, prior: null };
  const X = "scope#x";
  const Y = "scope#y";

  /** Feed observations in order, returning each step's corroboration. */
  function play(
    start: UnitAgreement,
    steps: [user: string, before: string | null, after: string][],
  ) {
    let unit = start;
    const fired: boolean[] = [];
    for (const [userId, before, after] of steps) {
      const r = observeUnit(unit, { userId, before, after });
      unit = r.next;
      fired.push(r.corroborated);
    }
    return { unit, fired };
  }

  it("fans a genuine change out on the second agreeing report, once", () => {
    const { fired } = play(EMPTY, [
      ["a", null, X],
      ["b", null, X],
      ["c", X, Y], // first report of the change
      ["d", X, Y], // corroborated
      ["e", X, Y], // already propagated
      ["f", X, Y],
    ]);
    expect(fired).toEqual([false, false, false, true, false, false]);
  });

  it("never fans out one student's private override", () => {
    // "b" alone was granted an extension: they flip to Y, everyone else keeps X.
    const { fired } = play(EMPTY, [
      ["a", null, X],
      ["b", X, Y],
      ["c", X, X],
      ["b", Y, Y],
      ["d", X, X],
      ["b", Y, Y],
    ]);
    expect(fired.some(Boolean)).toBe(false);
  });

  it("does not let the same student corroborate themselves", () => {
    const { fired } = play(EMPTY, [
      ["a", X, Y],
      ["a", X, Y],
    ]);
    expect(fired).toEqual([false, false]);
  });

  it("needs two CONSECUTIVE agreeing reports", () => {
    // A walker in between who still sees X resets the state.
    const { fired } = play(EMPTY, [
      ["c", X, Y],
      ["z", X, X],
      ["d", X, Y],
    ]);
    expect(fired).toEqual([false, false, false]);
  });

  it("does not treat a first-ever view as a transition", () => {
    const { fired } = play(EMPTY, [
      ["a", null, Y],
      ["b", null, Y],
    ]);
    expect(fired).toEqual([false, false]);
  });

  it("records who saw what, so the next walker can be compared", () => {
    const { unit } = play(EMPTY, [["c", X, Y]]);
    expect(unit).toEqual({ fingerprint: Y, by: "c", prior: X });
  });
});
