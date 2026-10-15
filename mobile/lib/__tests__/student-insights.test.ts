import type { StudentTermMarksDto } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { gradeShare, interpret, termTrends } from "../student-insights";

const term = (
  termId: string,
  gpa4: number,
  letters: string[],
  noCreditLetters: string[] = [],
): StudentTermMarksDto => ({
  yearStudy: "2023-2024",
  termId,
  gpa4,
  gpa10: null,
  creditsEarned: null,
  conductScore: null,
  marks: [
    ...letters.map((letter, i) => ({ letter, noCredit: false, i })),
    ...noCreditLetters.map((letter, i) => ({ letter, noCredit: true, i })),
  ].map((m) => ({
    curriculumId: `${termId}${m.i}${m.noCredit}`,
    curriculumName: "x",
    credits: 3,
    score10: 8,
    score4: 3,
    letter: m.letter,
    passed: true,
    noCredit: m.noCredit,
  })),
});

describe("student insights", () => {
  it("ignores no-credit courses in the grade share", () => {
    expect(gradeShare([term("HK02", 3.5, ["A", "B"], ["A"])])).toEqual({
      total: 2,
      a: 1,
      ab: 2,
    });
  });

  it("reads the trend against the older term", () => {
    const trends = termTrends([term("HK02", 3.8, []), term("HK01", 3.4, [])]);
    expect(trends.get("2023-2024|HK02")?.trend).toBe("up");
    expect(trends.has("2023-2024|HK01")).toBe(false);
  });

  it("returns nothing without a GPA", () => {
    expect(interpret(null, [])).toEqual([]);
  });

  it("describes a strong cumulative GPA and the trend", () => {
    const lines = interpret(3.85, [
      term("HK02", 3.8, ["A", "A"]),
      term("HK01", 3.4, ["B"]),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Excellent");
    expect(lines[1]).toContain("Up 0.40");
  });
});
