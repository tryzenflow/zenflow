import { isoWeek, monthsFrom, resolveSemester } from "./semester";

const VN = "Asia/Ho_Chi_Minh"; // UTC+7, no DST — the DLU_TZ default

/** A VN wall-clock instant, spelled as UTC (VN = UTC+7 year-round). */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("resolveSemester", () => {
  it.each([
    ["2026-08-01T08:00:00", "2026-2027", "HK01"],
    ["2026-10-15T08:00:00", "2026-2027", "HK01"],
    ["2026-12-31T08:00:00", "2026-2027", "HK01"],
    ["2027-01-01T08:00:00", "2026-2027", "HK02"],
    ["2027-05-31T08:00:00", "2026-2027", "HK02"],
    ["2027-06-01T08:00:00", "2026-2027", "HK03"],
    ["2027-07-31T08:00:00", "2026-2027", "HK03"],
    ["2027-08-01T08:00:00", "2027-2028", "HK01"],
  ])("%s → %s %s", (at, namhoc, hocky) => {
    expect(resolveSemester(vn(at), VN)).toEqual({ namhoc, hocky });
  });

  it("keeps namhoc across the Dec→Jan boundary (only hocky rolls)", () => {
    const dec = resolveSemester(vn("2026-12-31T23:30:00"), VN);
    const jan = resolveSemester(vn("2027-01-01T00:30:00"), VN);

    expect(dec).toEqual({ namhoc: "2026-2027", hocky: "HK01" });
    expect(jan).toEqual({ namhoc: "2026-2027", hocky: "HK02" });
    expect(jan.namhoc).toBe(dec.namhoc);
  });

  it("rolls namhoc across the Jul→Aug boundary", () => {
    expect(resolveSemester(vn("2026-07-31T23:30:00"), VN)).toEqual({
      namhoc: "2025-2026",
      hocky: "HK03",
    });
    expect(resolveSemester(vn("2026-08-01T00:30:00"), VN)).toEqual({
      namhoc: "2026-2027",
      hocky: "HK01",
    });
  });

  it("resolves in the requested timezone, not the host's", () => {
    // 2026-07-31T18:00Z is already 1 Aug in Vietnam — a new academic year.
    const instant = new Date("2026-07-31T18:00:00.000Z");

    expect(resolveSemester(instant, VN)).toEqual({
      namhoc: "2026-2027",
      hocky: "HK01",
    });
    expect(resolveSemester(instant, "UTC")).toEqual({
      namhoc: "2025-2026",
      hocky: "HK03",
    });
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
