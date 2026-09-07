import {
  isoWeek,
  isoWeeksBetween,
  monthsFrom,
  resolveSemester,
  SEMESTER_LOOKAHEAD_WEEKS,
} from "./semester";

const VN = "Asia/Ho_Chi_Minh"; // UTC+7, no DST — the DLU_TZ default

/** A VN wall-clock instant, spelled as UTC (VN = UTC+7 year-round). */
const vn = (iso: string) => new Date(`${iso}+07:00`);

/** A VN wall-clock day, at noon so no rounding can drift it. */
const day = (date: string) => vn(`${date}T12:00:00`);

/**
 * Boundaries of the 2026-2027 academic year, worked out by hand:
 *
 *  - 31 Jul 2026 is a Friday → its week opens Mon 27 Jul 2026 (HK01 opens)
 *  - 31 Dec 2026 is a Thursday → Mon 28 Dec 2026 (HK01 closes, HK02 opens)
 *  - 31 May 2027 is a Monday → Mon 31 May 2027 (HK02 closes, HK03 opens)
 *  - 31 Jul 2027 is a Saturday → Mon 26 Jul 2027 (HK03 closes, HK01 reopens)
 */
const HK01_OPENS = "2026-07-27";
const HK02_OPENS = "2026-12-28";
const HK03_OPENS = "2027-05-31";
const NEXT_HK01_OPENS = "2027-07-26";

/** `resolveSemester` at face value — the lookahead is exercised separately. */
const at = (date: string) => resolveSemester(day(date), VN, 0);

describe("resolveSemester", () => {
  it.each([
    // The week before HK01 opens still belongs to the outgoing HK03.
    ["2026-07-26", "2025-2026", "HK03"],
    [HK01_OPENS, "2026-2027", "HK01"],
    ["2026-10-15", "2026-2027", "HK01"],
    ["2026-12-27", "2026-2027", "HK01"],
    [HK02_OPENS, "2026-2027", "HK02"],
    ["2027-03-01", "2026-2027", "HK02"],
    ["2027-05-30", "2026-2027", "HK02"],
    [HK03_OPENS, "2026-2027", "HK03"],
    ["2027-07-25", "2026-2027", "HK03"],
    [NEXT_HK01_OPENS, "2027-2028", "HK01"],
  ])("%s → %s %s", (date, academicYear, semester) => {
    expect(at(date)).toMatchObject({ academicYear, semester });
  });

  it("spans HK01 from the last week of July to the last week of December", () => {
    const term = at("2026-10-15");

    expect(term.startDate).toEqual(vn(`${HK01_OPENS}T00:00:00.000`));
    // Ends the instant HK02 opens, so no ISO week belongs to both terms.
    expect(term.endDate).toEqual(
      new Date(vn(`${HK02_OPENS}T00:00:00.000`).getTime() - 1),
    );
  });

  it("spans HK02 across New Year, from December into late May", () => {
    const term = at("2027-03-01");

    expect(term.startDate).toEqual(vn(`${HK02_OPENS}T00:00:00.000`));
    expect(term.endDate).toEqual(
      new Date(vn(`${HK03_OPENS}T00:00:00.000`).getTime() - 1),
    );
  });

  it("spans HK03 from late May to the week before last in July", () => {
    const term = at("2027-06-15");

    expect(term.startDate).toEqual(vn(`${HK03_OPENS}T00:00:00.000`));
    expect(term.endDate).toEqual(
      new Date(vn(`${NEXT_HK01_OPENS}T00:00:00.000`).getTime() - 1),
    );
  });

  it("hands the terms off with no gap and no overlap", () => {
    const hk01 = at("2026-10-15");
    const hk02 = at("2027-03-01");
    const hk03 = at("2027-06-15");

    expect(hk02.startDate.getTime() - hk01.endDate.getTime()).toBe(1);
    expect(hk03.startDate.getTime() - hk02.endDate.getTime()).toBe(1);
  });

  it("keeps academicYear across the Dec→Jan boundary (only semester rolls)", () => {
    const dec = resolveSemester(vn("2026-12-31T23:30:00"), VN, 0);
    const jan = resolveSemester(vn("2027-01-01T00:30:00"), VN, 0);

    expect(dec).toMatchObject({ academicYear: "2026-2027", semester: "HK02" });
    expect(jan).toMatchObject({ academicYear: "2026-2027", semester: "HK02" });
    expect(jan.academicYear).toBe(dec.academicYear);
  });

  it("rolls academicYear where HK03 ends and the next HK01 opens", () => {
    expect(resolveSemester(vn("2026-07-26T23:30:00"), VN, 0)).toMatchObject({
      academicYear: "2025-2026",
      semester: "HK03",
    });
    expect(resolveSemester(vn("2026-07-27T00:30:00"), VN, 0)).toMatchObject({
      academicYear: "2026-2027",
      semester: "HK01",
    });
  });

  it("resolves in the requested timezone, not the host's", () => {
    // 2026-07-26T18:00Z is already Mon 27 Jul in Vietnam — a new academic year.
    const instant = new Date("2026-07-26T18:00:00.000Z");

    expect(resolveSemester(instant, VN, 0)).toMatchObject({
      academicYear: "2026-2027",
      semester: "HK01",
    });
    expect(resolveSemester(instant, "UTC", 0)).toMatchObject({
      academicYear: "2025-2026",
      semester: "HK03",
    });
  });

  it("looks ahead so the next term is resolved before it opens", () => {
    // A fortnight before HK02 opens, the watchers should already be fetching it.
    const justBefore = day("2026-12-20");

    expect(resolveSemester(justBefore, VN, 0).semester).toBe("HK01");
    expect(resolveSemester(justBefore, VN).semester).toBe("HK02");
    expect(SEMESTER_LOOKAHEAD_WEEKS).toBe(2);
  });

  it("reports the term's real window even when the lookahead resolved it early", () => {
    // The window describes the term, not the instant it was asked about, so a
    // `startDate` in the future is the correct answer here.
    const term = resolveSemester(day("2026-12-20"), VN);

    expect(term.startDate).toEqual(vn(`${HK02_OPENS}T00:00:00.000`));
    expect(term.startDate.getTime()).toBeGreaterThan(
      day("2026-12-20").getTime(),
    );
  });
});

describe("isoWeek", () => {
  it("matches the captured portal row (17/08/2026 ⇒ Week 34)", () => {
    expect(isoWeek(vn("2026-08-17T09:00:00"), VN)).toBe(34);
  });

  it("is constant across the whole ISO week (Mon–Sun)", () => {
    const weeks = [
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ].map((d) => isoWeek(vn(`${d}T12:00:00`), VN));

    expect(weeks).toEqual([34, 34, 34, 34, 34, 34, 34]);
    expect(isoWeek(vn("2026-08-24T12:00:00"), VN)).toBe(35);
  });

  it("puts late December into week 1 of the next ISO year", () => {
    // Monday 29 Dec 2025 starts the week that contains Thu 1 Jan 2026.
    expect(isoWeek(vn("2025-12-29T12:00:00"), VN)).toBe(1);
    expect(isoWeek(vn("2026-01-01T12:00:00"), VN)).toBe(1);
  });

  it("puts 1 Jan 2027 into week 53 of the long 2026 ISO year", () => {
    expect(isoWeek(vn("2026-12-31T12:00:00"), VN)).toBe(53);
    expect(isoWeek(vn("2027-01-01T12:00:00"), VN)).toBe(53);
    expect(isoWeek(vn("2027-01-04T12:00:00"), VN)).toBe(1);
  });

  it("uses the requested timezone for the day boundary", () => {
    // 2026-08-23T18:00Z = Mon 24 Aug 01:00 in Vietnam → the following week.
    const instant = new Date("2026-08-23T18:00:00.000Z");
    expect(isoWeek(instant, "UTC")).toBe(34);
    expect(isoWeek(instant, VN)).toBe(35);
  });
});

describe("isoWeeksBetween", () => {
  it("covers the whole of HK01, opening week to closing week", () => {
    const hk01 = at("2026-10-15");
    const weeks = isoWeeksBetween(hk01.startDate, hk01.endDate, VN);

    // Mon 27 Jul 2026 is week 31; Mon 21 Dec 2026, the last Monday inside the
    // term, is week 52.
    expect(weeks[0]).toBe(31);
    expect(weeks[weeks.length - 1]).toBe(52);
    expect(weeks).toHaveLength(22);
  });

  it("wraps 53 → 1 through HK02's New Year", () => {
    const hk02 = at("2027-03-01");
    const weeks = isoWeeksBetween(hk02.startDate, hk02.endDate, VN);

    expect(weeks.slice(0, 3)).toEqual([53, 1, 2]);
    expect(weeks[weeks.length - 1]).toBe(21);
    expect(weeks).toHaveLength(22);
  });

  it("covers HK03's short run", () => {
    const hk03 = at("2027-06-15");

    expect(isoWeeksBetween(hk03.startDate, hk03.endDate, VN)).toEqual([
      22, 23, 24, 25, 26, 27, 28, 29,
    ]);
  });

  it("includes the week `from` falls in, even mid-week", () => {
    // Thursday 20 Aug 2026 is inside week 34, which still has to be fetched
    // whole — the portal has no sub-week granularity.
    expect(isoWeeksBetween(day("2026-08-20"), day("2026-09-01"), VN)).toEqual([
      34, 35, 36,
    ]);
  });

  it("returns a single week when both ends sit in one", () => {
    expect(isoWeeksBetween(day("2026-08-17"), day("2026-08-23"), VN)).toEqual([
      34,
    ]);
  });

  it("returns nothing when `to` precedes the Monday of `from`'s week", () => {
    expect(isoWeeksBetween(day("2026-08-20"), day("2026-08-10"), VN)).toEqual(
      [],
    );
  });

  it("reads the week boundaries in the requested timezone", () => {
    // 2026-08-23T18:00Z is Sun 23 Aug in UTC but Mon 24 Aug in Vietnam.
    const instant = new Date("2026-08-23T18:00:00.000Z");
    const to = day("2026-08-30");

    expect(isoWeeksBetween(instant, to, "UTC")).toEqual([34, 35]);
    expect(isoWeeksBetween(instant, to, VN)).toEqual([35]);
  });
});

describe("monthsFrom", () => {
  it("returns the current month first, 1-based", () => {
    expect(monthsFrom(vn("2026-09-06T10:00:00"), VN, 1)).toEqual([
      { year: 2026, month: 9 },
    ]);
  });

  it("returns the current month and the next one", () => {
    expect(monthsFrom(vn("2026-09-06T10:00:00"), VN, 2)).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ]);
  });

  it("rolls the year over at the Dec to Jan boundary", () => {
    expect(monthsFrom(vn("2026-12-31T23:30:00"), VN, 2)).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });

  it("reads the month in the given timezone, not the host clock", () => {
    // 23:30 UTC on 31 Aug is already 06:30 on 1 Sep in Vietnam.
    const instant = new Date("2026-08-31T23:30:00.000Z");
    expect(monthsFrom(instant, "UTC", 1)).toEqual([{ year: 2026, month: 8 }]);
    expect(monthsFrom(instant, VN, 1)).toEqual([{ year: 2026, month: 9 }]);
  });

  it("wraps past a full year when asked for many months", () => {
    expect(monthsFrom(vn("2026-11-10T08:00:00"), VN, 4)).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);
  });
});
