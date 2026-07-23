import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { buildTierRationale } from "./rationale";

const TZ = "UTC";

function zeroMatrix(): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
}

// 2026-06-08 is a Monday (day index 0), 2026-06-09 is Tuesday (day index 1).
const MON_10 = new Date("2026-06-08T10:00:00.000Z");
const TUE_10 = new Date("2026-06-09T10:00:00.000Z");

function iv(start: Date, minutes = 60) {
  return { start: start.getTime(), end: start.getTime() + minutes * 60_000 };
}

describe("buildTierRationale — always non-null", () => {
  it("never returns null, even on a cold-start (all-zero) matrix", () => {
    const r = buildTierRationale(
      "tier1-preference",
      iv(MON_10),
      zeroMatrix(),
      TZ,
    );
    expect(r).not.toBeNull();
    expect(r.summary).toEqual(expect.any(String));
  });

  it("never returns null for an unplaced (saturated) result", () => {
    const r = buildTierRationale("unplaced", null, zeroMatrix(), TZ);
    expect(r).not.toBeNull();
    expect(r.summary).toContain("fully booked");
  });
});

describe("buildTierRationale — tier1-preference", () => {
  it("summarizes the dominant cell on the chosen weekday when the matrix has signal", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = 5; // Monday 09:00 strongly liked
    const r = buildTierRationale("tier1-preference", iv(MON_10), m, TZ);
    expect(r.preferredWindow).toEqual({ startMin: 540, endMin: 600 });
    expect(r.summary).toContain("Monday");
    expect(r.summary).toContain("09:00");
  });

  it("falls back to a generic preference phrase when the matrix has no signal on this weekday", () => {
    const m = zeroMatrix();
    m[1 * 24 + 10] = 5; // Tuesday liked, but chosenStart is Monday
    const r = buildTierRationale("tier1-preference", iv(MON_10), m, TZ);
    expect(r.summary).toEqual(expect.any(String));
    expect(r.preferredWindow).toBeUndefined();
  });

  it("only considers the weekday chosenStart falls in", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = 1; // Monday
    m[1 * 24 + 15] = 10; // Tuesday — much higher, but wrong day
    const r = buildTierRationale("tier1-preference", iv(TUE_10), m, TZ);
    expect(r.preferredWindow).toEqual({ startMin: 900, endMin: 960 });
  });

  it("appends an exploration note when usedExploration is set", () => {
    const m = zeroMatrix();
    m[0 * 24 + 9] = 5;
    const r = buildTierRationale("tier1-preference", iv(MON_10), m, TZ, {
      usedExploration: true,
    });
    expect(r.summary).toContain("different");
  });
});

describe("buildTierRationale — tier1-earliest / tier2 / tier3 / unplaced", () => {
  it("tier1-earliest: a plain earliest-slot phrase", () => {
    const r = buildTierRationale("tier1-earliest", iv(MON_10), [], TZ);
    expect(r.summary).toContain("earliest");
  });

  it("tier2: names the off-hours/full-work-hours tradeoff", () => {
    const r = buildTierRationale("tier2", iv(MON_10), [], TZ);
    expect(r.summary).toContain("outside");
  });

  it("tier3: names the past-deadline tradeoff", () => {
    const r = buildTierRationale("tier3", iv(MON_10), [], TZ);
    expect(r.summary).toContain("deadline");
  });

  it("unplaced: names the saturated-calendar case", () => {
    const r = buildTierRationale("unplaced", null, [], TZ);
    expect(r.summary).toContain("fully booked");
  });
});

describe("buildTierRationale — direct (manual drag/resize)", () => {
  it("names the new time when there's no conflict", () => {
    const r = buildTierRationale("direct", iv(MON_10), [], TZ);
    expect(r.summary).toContain("Moved to");
    expect(r.summary).not.toContain("overlaps");
  });
});

describe("buildTierRationale — conflictWithTitle overrides everything", () => {
  it("produces conflict-notice phrasing naming the overlapped task, regardless of tier", () => {
    const r = buildTierRationale("direct", iv(MON_10), [], TZ, {
      conflictWithTitle: "Draft proposal",
    });
    expect(r.summary).toContain("overlaps with 'Draft proposal'");
  });

  it("takes priority even for a tiered (automatic) placement", () => {
    const r = buildTierRationale("tier1-earliest", iv(MON_10), [], TZ, {
      conflictWithTitle: "Standup",
    });
    expect(r.summary).toContain("overlaps with 'Standup'");
  });
});

describe("buildTierRationale — timezone honours the wall-clock weekday", () => {
  it("uses the local weekday, not UTC's, for a non-UTC timezone", () => {
    // 2026-06-08T23:00:00Z is already Tuesday in a UTC+4 zone.
    const m = zeroMatrix();
    m[1 * 24 + 3] = 5; // Tuesday 03:00 local
    const instant = new Date("2026-06-08T23:00:00.000Z");
    const r = buildTierRationale(
      "tier1-preference",
      iv(instant),
      m,
      "Asia/Dubai",
    );
    expect(r.preferredWindow).toEqual({ startMin: 180, endMin: 240 });
  });
});
