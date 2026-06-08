import { workWindowFor, workWindowMinutes } from "./slot";

describe("workWindowMinutes", () => {
  it("non-wrap window is workEnd - workStart", () => {
    // 09:00 → 17:00 = 480 min
    expect(workWindowMinutes(540, 1020)).toBe(480);
  });

  it("wrap window crosses midnight (22:00 → 04:00 = 360 min)", () => {
    expect(workWindowMinutes(1320, 240)).toBe(360);
  });

  it("midnight-end (workEnd = 0) counts to the day's end", () => {
    // 22:00 → 00:00 = 120 min (wraps, since 0 <= 1320)
    expect(workWindowMinutes(1320, 0)).toBe(120);
  });
});

describe("workWindowFor", () => {
  it("non-wrap window keeps start and end on the same calendar day", () => {
    const win = workWindowFor("2026-06-08", 540, 1020, "UTC");
    expect(new Date(win.start).toISOString()).toBe("2026-06-08T09:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-06-08T17:00:00.000Z");
  });

  it("wrap window puts end on the next calendar day", () => {
    // 22:00 day D → 04:00 day D+1
    const win = workWindowFor("2026-06-08", 1320, 240, "UTC");
    expect(new Date(win.start).toISOString()).toBe("2026-06-08T22:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-06-09T04:00:00.000Z");
  });

  it("midnight-end wrap lands at 00:00 of the next day", () => {
    const win = workWindowFor("2026-06-08", 1320, 0, "UTC");
    expect(new Date(win.start).toISOString()).toBe("2026-06-08T22:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-06-09T00:00:00.000Z");
  });

  it("is DST-correct across a spring-forward boundary (via minutesToUtc)", () => {
    // America/New_York springs forward 2026-03-08 02:00 → 03:00 (loses an hour).
    // A 22:00 → 04:00 window anchored to 2026-03-07 spans that transition: the
    // wall-clock end on 03-08 04:00 is EDT (UTC-4), the start 03-07 22:00 is EST
    // (UTC-5), so the absolute span is 5h, not 6h.
    const win = workWindowFor("2026-03-07", 1320, 240, "America/New_York");
    expect(new Date(win.start).toISOString()).toBe("2026-03-08T03:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });
});
