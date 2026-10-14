import { computeStreak, dayKey } from "./streak";

/** `n` consecutive days starting at `from` (YYYY-MM-DD). */
function run(from: string, n: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

describe("dayKey", () => {
  it("uses the user's wall-clock day", () => {
    const instant = new Date("2026-10-13T18:30:00.000Z");
    expect(dayKey(instant, "UTC")).toBe("2026-10-13");
    expect(dayKey(instant, "Asia/Ho_Chi_Minh")).toBe("2026-10-14");
  });
});

describe("computeStreak", () => {
  it("is empty with no completions", () => {
    expect(computeStreak([], "2026-10-14")).toEqual({
      current: 0,
      longest: 0,
      freezesAvailable: 0,
      frozenDays: [],
      lastActiveDay: null,
      todayDone: false,
    });
  });

  it("counts consecutive days and dedupes a day with several completions", () => {
    const s = computeStreak(
      ["2026-10-12", "2026-10-13", "2026-10-13", "2026-10-14"],
      "2026-10-14",
    );
    expect(s).toMatchObject({ current: 3, longest: 3, todayDone: true });
  });

  it("keeps the streak while today is still open", () => {
    const s = computeStreak(["2026-10-12", "2026-10-13"], "2026-10-14");
    expect(s).toMatchObject({ current: 2, todayDone: false });
  });

  it("resets after a missed day with no freeze", () => {
    const s = computeStreak(
      ["2026-10-10", "2026-10-11", "2026-10-13"],
      "2026-10-14",
    );
    expect(s).toMatchObject({ current: 1, longest: 2, frozenDays: [] });
  });

  it("drops to zero when yesterday was missed and today is open", () => {
    const s = computeStreak(["2026-10-11", "2026-10-12"], "2026-10-14");
    expect(s.current).toBe(0);
    expect(s.lastActiveDay).toBe("2026-10-12");
  });

  it("earns a freeze every 7 days and spends it on a missed day", () => {
    const days = [...run("2026-10-01", 7), "2026-10-09"];
    const s = computeStreak(days, "2026-10-09");
    expect(s).toMatchObject({
      current: 8,
      freezesAvailable: 0,
      frozenDays: ["2026-10-08"],
    });
  });

  it("banks at most two freezes", () => {
    const s = computeStreak(run("2026-09-01", 28), "2026-09-28");
    expect(s.freezesAvailable).toBe(2);
  });

  it("ignores completions after today", () => {
    const s = computeStreak(["2026-10-14", "2026-10-15"], "2026-10-14");
    expect(s).toMatchObject({ current: 1, lastActiveDay: "2026-10-14" });
  });
});
