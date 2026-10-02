import {
  batchSizeFor,
  discoveredForTerm,
  isDiscoveryKind,
  mustFullWalk,
  nextDueAfterRun,
  orderedPlans,
  providerOfKind,
  TERM_RETRY_MS,
  termKey,
  TICK_INTERVAL_MS,
  type SyncKindPlan,
} from "./schedule-plan";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-26T03:00:00.000Z");

function plan(over: Partial<SyncKindPlan> = {}): SyncKindPlan {
  return {
    kind: "PORTAL_TIMETABLE",
    provider: "PORTAL",
    targetPeriodMs: DAY,
    order: 10,
    discovery: false,
    ...over,
  };
}

const base = {
  tickIntervalMs: TICK_INTERVAL_MS,
  minBatch: 1,
  maxBatch: 50,
};

describe("batchSizeFor", () => {
  it("matches the issue's worked example (500 students, 24h, 5-min ticks)", () => {
    // 24h / 5min = 288 ticks/day; 500 / 288 = 1.74 -> 2.
    expect(
      batchSizeFor({
        ...base,
        population: 500,
        targetPeriodMs: DAY,
        tickIntervalMs: 5 * 60_000,
      }),
    ).toBe(2);
  });

  it("is 1 for the shipped shape (500 students, 24h, 1-min ticks)", () => {
    // 1440 ticks/day comfortably covers 500 students one at a time.
    expect(
      batchSizeFor({ ...base, population: 500, targetPeriodMs: DAY }),
    ).toBe(1);
  });

  it("clamps up to minBatch when the population is smaller than the tick count", () => {
    // 10 / 1440 rounds to 1 by ceil, but the floor is what guarantees it.
    expect(batchSizeFor({ ...base, population: 10, targetPeriodMs: DAY })).toBe(
      1,
    );
    expect(
      batchSizeFor({ ...base, population: 1, targetPeriodMs: DAY }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("clamps down to maxBatch, so a mis-set period cannot burst", () => {
    // An hourly period over 150 students wants 3/tick; a 1-minute period wants
    // all 150 — the ceiling is what stops the latter.
    expect(
      batchSizeFor({ ...base, population: 150, targetPeriodMs: HOUR }),
    ).toBe(3);
    expect(
      batchSizeFor({
        ...base,
        population: 150,
        targetPeriodMs: TICK_INTERVAL_MS,
        maxBatch: 5,
      }),
    ).toBe(5);
  });

  it("lets a deliberately huge maxBatch reproduce the pre-#56 burst", () => {
    // How the measurement harness replays "all three watchers on EVERY_MINUTE"
    // without editing a @Cron: period == tick interval, ceiling lifted.
    expect(
      batchSizeFor({
        ...base,
        population: 150,
        targetPeriodMs: TICK_INTERVAL_MS,
        maxBatch: 1000,
      }),
    ).toBe(150);
  });

  it("is 0 for an empty population, so an idle deployment claims nothing", () => {
    expect(batchSizeFor({ ...base, population: 0, targetPeriodMs: DAY })).toBe(
      0,
    );
  });

  it("treats a sub-tick period as one tick rather than dividing by less than 1", () => {
    // Guards against ticksPerPeriod < 1 inflating the batch beyond the population.
    expect(
      batchSizeFor({
        ...base,
        population: 30,
        targetPeriodMs: 1_000,
        maxBatch: 1000,
      }),
    ).toBe(30);
  });
});

describe("nextDueAfterRun", () => {
  it("measures the next due time from the claim, not from the old due time", () => {
    expect(nextDueAfterRun(NOW, DAY)).toEqual(
      new Date("2026-10-27T03:00:00.000Z"),
    );
  });

  it("spreads an all-due-at-once population over one period, and keeps it spread", () => {
    // The property the absence of jitter rests on. 150 rows all seeded due at
    // T, one-minute ticks, a 60-minute period, 3 claimed per tick: every row is
    // claimed exactly once within the period, no tick exceeds batchSize, and
    // the due times they come back with are already fanned out.
    const period = 60 * 60_000;
    const rows = Array.from({ length: 150 }, (_, i) => ({
      id: i,
      nextDueAt: NOW,
    }));
    const batchSize = batchSizeFor({
      ...base,
      population: rows.length,
      targetPeriodMs: period,
    });
    expect(batchSize).toBe(3);

    const claimedAt = new Map<number, number>();
    for (let tick = 0; tick < 60; tick++) {
      const tickNow = new Date(NOW.getTime() + tick * TICK_INTERVAL_MS);
      const due = rows
        .filter((r) => r.nextDueAt.getTime() <= tickNow.getTime())
        .sort((a, b) => a.nextDueAt.getTime() - b.nextDueAt.getTime())
        .slice(0, batchSize);
      expect(due.length).toBeLessThanOrEqual(batchSize);
      for (const row of due) {
        expect(claimedAt.has(row.id)).toBe(false);
        claimedAt.set(row.id, tick);
        row.nextDueAt = nextDueAfterRun(tickNow, period);
      }
    }

    // Everyone served exactly once in the period…
    expect(claimedAt.size).toBe(150);
    // …and their next due times now occupy 50 distinct minutes rather than one.
    expect(new Set(rows.map((r) => r.nextDueAt.getTime())).size).toBe(50);
  });
});

describe("termKey / discoveredForTerm", () => {
  const TERM = { academicYear: "2026-2027", semester: "HK01" };

  it("keys a term by year and semester", () => {
    expect(termKey(TERM)).toBe("2026-2027/HK01");
  });

  it("is true only when the last clean pass was for exactly this term", () => {
    expect(discoveredForTerm("2026-2027/HK01", TERM)).toBe(true);
    expect(discoveredForTerm("2026-2027/HK02", TERM)).toBe(false);
    expect(discoveredForTerm("2025-2026/HK01", TERM)).toBe(false);
  });

  it("is false before any pass has succeeded", () => {
    expect(discoveredForTerm("", TERM)).toBe(false);
    expect(discoveredForTerm(null, TERM)).toBe(false);
    expect(discoveredForTerm(undefined, TERM)).toBe(false);
  });

  it("retries a failing term change no faster than hourly", () => {
    expect(TERM_RETRY_MS).toBe(HOUR);
  });
});

describe("mustFullWalk", () => {
  it("allows cache hits below the audit interval", () => {
    expect(mustFullWalk({ cacheHitStreak: 0, fullWalkEvery: 7 })).toBe(false);
    expect(mustFullWalk({ cacheHitStreak: 6, fullWalkEvery: 7 })).toBe(false);
  });

  it("forces a walk once the streak reaches the interval", () => {
    expect(mustFullWalk({ cacheHitStreak: 7, fullWalkEvery: 7 })).toBe(true);
    expect(mustFullWalk({ cacheHitStreak: 99, fullWalkEvery: 7 })).toBe(true);
  });

  it("treats a non-positive interval as 'never serve from cache'", () => {
    // A safe reading of a misconfigured value: do more work, not less.
    expect(mustFullWalk({ cacheHitStreak: 0, fullWalkEvery: 0 })).toBe(true);
    expect(mustFullWalk({ cacheHitStreak: 0, fullWalkEvery: -1 })).toBe(true);
  });
});

describe("kind helpers", () => {
  it("names the two discovery kinds", () => {
    expect(isDiscoveryKind("PORTAL_DISCOVERY")).toBe(true);
    expect(isDiscoveryKind("LMS_DISCOVERY")).toBe(true);
    expect(isDiscoveryKind("PORTAL_TIMETABLE")).toBe(false);
    expect(isDiscoveryKind("PORTAL_EXAM")).toBe(false);
    expect(isDiscoveryKind("LMS_CALENDAR")).toBe(false);
  });

  it("maps every kind to the provider whose Integration rows it needs", () => {
    expect(providerOfKind("LMS_DISCOVERY")).toBe("LMS");
    expect(providerOfKind("LMS_CALENDAR")).toBe("LMS");
    expect(providerOfKind("PORTAL_DISCOVERY")).toBe("PORTAL");
    expect(providerOfKind("PORTAL_TIMETABLE")).toBe("PORTAL");
    expect(providerOfKind("PORTAL_EXAM")).toBe("PORTAL");
  });

  it("orders discovery kinds ahead of the walks", () => {
    const ordered = orderedPlans([
      plan({ kind: "PORTAL_TIMETABLE", order: 10 }),
      plan({ kind: "PORTAL_DISCOVERY", order: 1, discovery: true }),
      plan({ kind: "LMS_CALENDAR", order: 12 }),
      plan({ kind: "LMS_DISCOVERY", order: 2, discovery: true }),
    ]);
    expect(ordered.map((p) => p.kind)).toEqual([
      "PORTAL_DISCOVERY",
      "LMS_DISCOVERY",
      "PORTAL_TIMETABLE",
      "LMS_CALENDAR",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const input = [plan({ order: 2 }), plan({ order: 1 })];
    orderedPlans(input);
    expect(input.map((p) => p.order)).toEqual([2, 1]);
  });
});
