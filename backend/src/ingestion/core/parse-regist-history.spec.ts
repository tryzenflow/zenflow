import {
  parseRegistHistory,
  type PortalRegistHistoryRow,
} from "./parse-regist-history";

// Every id below is deliberately fictional; the shapes mirror a real
// `getAllRegistHistory` response.
const TERM = { academicYear: "2026-2027", termId: "HK01" };

function event(over: Partial<PortalRegistHistoryRow>): PortalRegistHistoryRow {
  return {
    CurriculumID: "99910AB100101",
    CurriculumName: "Môn học Mẫu Một ()",
    Status: 1,
    UpdateDate: "2026-06-09 09:50:34",
    YearStudy: "2026-2027",
    TermID: "HK01",
    ...over,
  };
}

const ids = (rows: PortalRegistHistoryRow[]) =>
  parseRegistHistory(rows, TERM).sections.map((s) => s.scheduleStudyUnitId);

describe("parseRegistHistory", () => {
  it("keeps a registered section and trims the stray () on its name", () => {
    const { sections, skipped } = parseRegistHistory([event({})], TERM);
    expect(sections).toEqual([
      {
        scheduleStudyUnitId: "99910AB100101",
        curriculumId: "99910AB100101",
        curriculumName: "Môn học Mẫu Một",
        yearStudy: "2026-2027",
        termId: "HK01",
      },
    ]);
    expect(skipped).toEqual([]);
  });

  it("trims a non-empty trailing suffix such as (DKHP_WIN)", () => {
    const { sections } = parseRegistHistory(
      [event({ CurriculumName: "Thiết kế Web (DKHP_WIN)" })],
      TERM,
    );
    expect(sections[0].curriculumName).toBe("Thiết kế Web");
  });

  it("omits a section whose latest event is a cancellation", () => {
    expect(
      ids([
        event({ Status: 1, UpdateDate: "2026-06-09 09:50:34" }),
        event({ Status: 0, UpdateDate: "2026-07-14 16:16:59" }),
      ]),
    ).toEqual([]);
  });

  it("keeps a section registered again after a cancellation", () => {
    expect(
      ids([
        event({ Status: 1, UpdateDate: "2026-07-24 16:05:26" }),
        event({ Status: 0, UpdateDate: "2026-07-24 16:54:04" }),
        event({ Status: 1, UpdateDate: "2026-07-24 17:25:28" }),
      ]),
    ).toEqual(["99910AB100101"]);
  });

  it("orders by UpdateDate, not by position in the response", () => {
    expect(
      ids([
        event({ Status: 1, UpdateDate: "2026-07-24 17:25:28" }),
        event({ Status: 0, UpdateDate: "2026-07-24 16:54:04" }),
      ]),
    ).toEqual(["99910AB100101"]);
  });

  it("handles a swap: the old section cancelled, the new one registered", () => {
    expect(
      ids([
        event({
          CurriculumID: "A",
          Status: 1,
          UpdateDate: "2026-06-09 09:00:00",
        }),
        event({
          CurriculumID: "A",
          Status: 0,
          UpdateDate: "2026-07-14 16:16:59",
        }),
        event({
          CurriculumID: "B",
          Status: 1,
          UpdateDate: "2026-07-14 16:16:59",
        }),
      ]),
    ).toEqual(["B"]);
  });

  it("ignores rows from another year or term", () => {
    expect(
      ids([
        event({ YearStudy: "2025-2026" }),
        event({ TermID: "HK02", CurriculumID: "X" }),
      ]),
    ).toEqual([]);
  });

  it("accepts a numeric-string Status", () => {
    expect(ids([event({ Status: "1" })])).toEqual(["99910AB100101"]);
  });

  it("skips rows without a CurriculumID or a usable Status", () => {
    const { sections, skipped } = parseRegistHistory(
      [
        event({ CurriculumID: "  " }),
        event({ CurriculumID: "Z", Status: null }),
      ],
      TERM,
    );
    expect(sections).toEqual([]);
    expect(skipped).toHaveLength(2);
  });

  it("tolerates null and empty input", () => {
    expect(parseRegistHistory(null, TERM)).toEqual({
      sections: [],
      skipped: [],
    });
    expect(parseRegistHistory([], TERM).sections).toEqual([]);
  });
});
