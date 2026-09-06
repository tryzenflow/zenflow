import {
  GRID_MINUTES,
  ceilToGrid,
  floorToGrid,
  snapInstantsToGrid,
  snapToGrid,
} from "./grid";

const hm = (h: number, m = 0) => h * 60 + m;

describe("floorToGrid / ceilToGrid", () => {
  it("is a no-op on the grid", () => {
    expect(floorToGrid(450)).toBe(450);
    expect(ceilToGrid(450)).toBe(450);
  });

  it("floors down and ceils up off the grid", () => {
    expect(floorToGrid(hm(7, 39))).toBe(hm(7, 30));
    expect(ceilToGrid(hm(7, 39))).toBe(hm(7, 45));
  });

  it("handles the last slot of the day (23:59 → 23:45 / 24:00)", () => {
    expect(floorToGrid(hm(23, 59))).toBe(hm(23, 45));
    expect(ceilToGrid(hm(23, 59))).toBe(hm(24));
  });
});

describe("snapToGrid", () => {
  // The two off-grid shapes that forced this helper to exist.
  it("widens a 4-period morning lecture 07:30–11:10 to 225 minutes", () => {
    expect(snapToGrid(hm(7, 30), hm(11, 10))).toEqual({
      startMin: hm(7, 30),
      endMin: hm(11, 15),
      durationMinutes: 225,
    });
  });

  it("pulls the 16:40 evening block start back to 16:30 (210 minutes)", () => {
    expect(snapToGrid(hm(16, 40), hm(20, 0))).toEqual({
      startMin: hm(16, 30),
      endMin: hm(20, 0),
      durationMinutes: 210,
    });
  });

  it("leaves an already-aligned span untouched (periods 7–10)", () => {
    expect(snapToGrid(hm(13, 0), hm(16, 30))).toEqual({
      startMin: hm(13, 0),
      endMin: hm(16, 30),
      durationMinutes: 210,
    });
  });

  it("always yields a positive multiple of 15", () => {
    for (let start = 0; start < 120; start++) {
      for (let len = 0; len < 90; len++) {
        const { startMin, durationMinutes } = snapToGrid(start, start + len);
        expect(startMin % GRID_MINUTES).toBe(0);
        expect(durationMinutes).toBeGreaterThan(0);
        expect(durationMinutes % GRID_MINUTES).toBe(0);
      }
    }
  });

  it("collapses a zero-width or inverted span to one slot", () => {
    expect(snapToGrid(450, 450)).toEqual({
      startMin: 450,
      endMin: 465,
      durationMinutes: 15,
    });
    expect(snapToGrid(450, 400)).toEqual({
      startMin: 450,
      endMin: 465,
      durationMinutes: 15,
    });
  });

  it("rejects non-finite bounds rather than emitting NaN durations", () => {
    expect(() => snapToGrid(NaN, 60)).toThrow(/finite/);
    expect(() => snapToGrid(0, Infinity)).toThrow(/finite/);
  });
});

describe("snapInstantsToGrid", () => {
  // The real quiz from quiz_lms.json: open 17:35, close 18:25 (VN, UTC+7).
  it("widens the 50-minute quiz window to 17:30–18:30 (60 minutes)", () => {
    const open = new Date(1729852500 * 1000); // 2024-10-25T10:35:00Z
    const close = new Date(1729855500 * 1000); // 2024-10-25T11:25:00Z

    expect(snapInstantsToGrid(open, close)).toEqual({
      scheduledStartTime: new Date("2024-10-25T10:30:00.000Z"),
      durationMinutes: 60,
    });
  });

  it("is a no-op on an already-aligned window", () => {
    expect(
      snapInstantsToGrid(
        new Date("2026-04-01T02:00:00.000Z"),
        new Date("2026-04-01T03:30:00.000Z"),
      ),
    ).toEqual({
      scheduledStartTime: new Date("2026-04-01T02:00:00.000Z"),
      durationMinutes: 90,
    });
  });

  it("never returns a zero-width block for two identical instants", () => {
    const t = new Date("2026-04-01T02:07:00.000Z");
    expect(snapInstantsToGrid(t, t)).toEqual({
      scheduledStartTime: new Date("2026-04-01T02:00:00.000Z"),
      durationMinutes: 15,
    });
  });
});
