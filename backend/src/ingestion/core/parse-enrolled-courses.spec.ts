import {
  allEnrolledCourses,
  classifyCurrentTerm,
  type MoodleEnrolledCourse,
} from "./parse-enrolled-courses";

// HK01 of the fictional 2026-2027 year: 27 Jul 2026 → 20 Dec 2026 (VN).
const TERM = {
  semester: "HK01" as const,
  startDate: new Date("2026-07-26T17:00:00.000Z"),
  endDate: new Date("2026-12-20T16:59:59.999Z"),
};

/** Epoch seconds, as Moodle emits them. */
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function course(
  over: Partial<MoodleEnrolledCourse> = {},
): MoodleEnrolledCourse {
  return {
    id: 20001,
    fullname: "Môn học Mẫu Một - TESTCLASS-IT-A",
    shortname: "TESTCUR-IT-101",
    coursecategory: "Học kỳ 1",
    startdate: secs("2026-09-01T00:00:00.000Z"),
    visible: true,
    hidden: false,
    ...over,
  };
}

describe("classifyCurrentTerm — kept", () => {
  it("keeps a visible in-term course whose category names the term", () => {
    const { current, excluded } = classifyCurrentTerm([course()], TERM);

    expect(excluded).toEqual([]);
    expect(current).toEqual([
      {
        lmsCourseId: 20001,
        fullName: "Môn học Mẫu Một - TESTCLASS-IT-A",
        shortName: "TESTCUR-IT-101",
        courseCategory: "Học kỳ 1",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
        hidden: false,
      },
    ]);
  });

  it("keeps a course with no start date — absence of evidence is not exclusion", () => {
    // Moodle emits 0, not null, for "unset".
    const { current } = classifyCurrentTerm([course({ startdate: 0 })], TERM);
    expect(current).toHaveLength(1);
    expect(current[0].startDate).toBeNull();
  });

  it("keeps a course whose category carries no digits, and counts it unknown", () => {
    // The flimsiest signal: a category naming convention is whatever whoever set
    // the Moodle up chose, so it must never drop a course on a guess.
    const { current, excluded, unknownCategory } = classifyCurrentTerm(
      [course({ coursecategory: "Đại học chính quy" })],
      TERM,
    );
    expect(current).toHaveLength(1);
    expect(excluded).toEqual([]);
    expect(unknownCategory).toBe(1);
  });

  it("keeps a course with no category at all", () => {
    const { current, unknownCategory } = classifyCurrentTerm(
      [course({ coursecategory: null })],
      TERM,
    );
    expect(current).toHaveLength(1);
    expect(unknownCategory).toBe(1);
  });

  it("matches a category naming the term in other shapes", () => {
    for (const category of ["HK1", "Semester 1", "Học kỳ 1 (2026-2027)"]) {
      const { current } = classifyCurrentTerm(
        [course({ coursecategory: category })],
        TERM,
      );
      expect(current).toHaveLength(1);
    }
  });

  it("accepts a course starting exactly on the term boundary", () => {
    for (const at of [TERM.startDate, TERM.endDate]) {
      const { current } = classifyCurrentTerm(
        [course({ startdate: Math.floor(at.getTime() / 1000) })],
        TERM,
      );
      expect(current).toHaveLength(1);
    }
  });
});

describe("classifyCurrentTerm — excluded, with the signal that did it", () => {
  it("excludes a hidden course", () => {
    const { current, excluded } = classifyCurrentTerm(
      [course({ hidden: true })],
      TERM,
    );
    expect(current).toEqual([]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toBe("hidden");
  });

  it("excludes on `hidden` even when `visible` disagrees", () => {
    // The captured sample has visible:true AND hidden:true on the same course,
    // so the two are not complements. `hidden` is the one Moodle acts on.
    const { current, excluded } = classifyCurrentTerm(
      [course({ visible: true, hidden: true })],
      TERM,
    );
    expect(current).toEqual([]);
    expect(excluded[0].reason).toBe("hidden");
    // Recorded, so a shadow-mode report can show the disagreement.
    expect(excluded[0].hidden).toBe(true);
  });

  it("excludes a course that started before the term", () => {
    const { excluded } = classifyCurrentTerm(
      [course({ startdate: secs("2025-09-01T00:00:00.000Z") })],
      TERM,
    );
    expect(excluded[0].reason).toBe("startdate-outside-term");
  });

  it("excludes a course that starts after the term ends", () => {
    const { excluded } = classifyCurrentTerm(
      [course({ startdate: secs("2027-03-01T00:00:00.000Z") })],
      TERM,
    );
    expect(excluded[0].reason).toBe("startdate-outside-term");
  });

  it("excludes a course whose category names a different term", () => {
    const { excluded } = classifyCurrentTerm(
      [course({ coursecategory: "Học kỳ 2" })],
      TERM,
    );
    expect(excluded[0].reason).toBe("category-mismatch");
  });

  it("reports the first signal that fired, not all of them", () => {
    // So a shadow-mode log line names one cause a reader can act on.
    const { excluded } = classifyCurrentTerm(
      [
        course({
          hidden: true,
          startdate: secs("2020-01-01T00:00:00.000Z"),
          coursecategory: "Học kỳ 3",
        }),
      ],
      TERM,
    );
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toBe("hidden");
  });

  it("splits a realistic history into this term and the rest", () => {
    const { current, excluded } = classifyCurrentTerm(
      [
        course({ id: 20001 }),
        course({ id: 20002, hidden: true }),
        course({ id: 20003, startdate: secs("2024-09-01T00:00:00.000Z") }),
        course({ id: 20004, coursecategory: "Học kỳ 2" }),
      ],
      TERM,
    );

    expect(current.map((c) => c.lmsCourseId)).toEqual([20001]);
    expect(excluded.map((c) => [c.lmsCourseId, c.reason])).toEqual([
      [20002, "hidden"],
      [20003, "startdate-outside-term"],
      [20004, "category-mismatch"],
    ]);
  });
});

describe("classifyCurrentTerm — degenerate inputs", () => {
  it("drops a row with no usable course id", () => {
    const { current, excluded } = classifyCurrentTerm(
      [course({ id: null }), course({ id: 1.5 })],
      TERM,
    );
    expect(current).toEqual([]);
    expect(excluded).toEqual([]);
  });

  it("falls back to the id as a name rather than an empty string", () => {
    const { current } = classifyCurrentTerm(
      [course({ fullname: "   ", shortname: "" })],
      TERM,
    );
    expect(current[0]).toMatchObject({ fullName: "20001", shortName: null });
  });

  it("has no category opinion when the term id is not HKnn", () => {
    const { current, unknownCategory } = classifyCurrentTerm([course()], {
      ...TERM,
      semester: "HK99" as unknown as "HK01",
    });
    expect(current).toHaveLength(1);
    expect(unknownCategory).toBe(1);
  });

  it("tolerates a null or empty payload", () => {
    expect(classifyCurrentTerm(null, TERM)).toEqual({
      current: [],
      excluded: [],
      unknownCategory: 0,
    });
    expect(classifyCurrentTerm([], TERM).current).toEqual([]);
  });
});

describe("allEnrolledCourses", () => {
  it("normalises every row, filter or no filter", () => {
    // What shadow mode compares the filter's verdict against.
    const all = allEnrolledCourses([
      course({ id: 20001 }),
      course({ id: 20002, hidden: true }),
      course({ id: null }),
    ]);
    expect(all.map((c) => c.lmsCourseId)).toEqual([20001, 20002]);
  });

  it("tolerates a null payload", () => {
    expect(allEnrolledCourses(null)).toEqual([]);
  });
});
