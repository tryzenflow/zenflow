import { BanditPlacer } from "./bandit-placer.service";

/**
 * `BanditPlacer` with a deterministic mocked `BanditService` and an
 * empty in-memory-ish Prisma double. The pure math (context vector, overlap
 * rate, arm bands) is covered by `context-vector.spec.ts` / `utils/arms.spec.ts`.
 */

const TZ = "UTC";
const MATRIX: number[] = [];

function makePrisma(
  occupied: { start: string; durationMinutes: number }[] = [],
) {
  return {
    session: {
      findMany: jest.fn().mockResolvedValue(
        occupied.map((o) => ({
          scheduledStartTime: new Date(o.start),
          durationMinutes: o.durationMinutes,
          type: "ASSIGNMENT",
        })),
      ),
    },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeBandit(
  predictImpl: (
    contexts: { day: string; x: number[] }[],
  ) => Record<string, Record<string, number>> | null,
) {
  return {
    enabled: true,
    predict: jest.fn((contexts: { day: string; x: number[] }[]) =>
      Promise.resolve(predictImpl(contexts)),
    ),
    update: jest.fn(),
  };
}

const armStates = {
  loadAll: jest.fn().mockResolvedValue({
    EARLY_MORNING: { A: [], b: [], version: 0 },
    MORNING: { A: [], b: [], version: 0 },
    AFTERNOON: { A: [], b: [], version: 0 },
    EVENING: { A: [], b: [], version: 0 },
    NIGHT: { A: [], b: [], version: 0 },
  }),
  save: jest.fn(),
};

const NIGHT_WINS = (contexts: { day: string; x: number[] }[]) => {
  const out: Record<string, Record<string, number>> = {};
  for (const c of contexts) {
    out[c.day] = {
      EARLY_MORNING: 0,
      MORNING: 0,
      AFTERNOON: 0,
      EVENING: 0,
      NIGHT: 1,
    };
  }
  return out;
};

describe("BanditPlacer.scheduleTask", () => {
  const task = {
    id: "t1",
    durationMinutes: 60,
    deadline: new Date("2026-06-18T00:00:00.000Z"),
  };
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("places an empty-calendar task in the highest-scored arm's band, earliest start", async () => {
    const bandit = makeBandit(NIGHT_WINS);
    const svc = new BanditPlacer(
      makePrisma() as never,
      bandit as never,
      armStates as never,
    );

    const pick = await svc.placeTask("u1", task, TZ, MATRIX, now);

    expect(pick).not.toBeNull();
    expect(pick!.selectedArm).toBe("NIGHT");
    // NIGHT band is [20:00, 24:00); earliest fully-NIGHT 60-min slot on day 1.
    expect(pick!.scheduledStartTime.toISOString()).toBe(
      "2026-06-15T20:00:00.000Z",
    );
    expect(pick!.featureVector).toHaveLength(46);
    expect(bandit.predict).toHaveBeenCalledTimes(1);
  });

  it("places a task that only fits across local midnight (D5)", async () => {
    // June 15 is booked 00:00–23:00, leaving a 60-min gap before midnight for a
    // 90-min task. With midnight crossover allowed, LinUCB starts it at 23:00
    // and lets it run into June 16 up to the deadline.
    const bandit = makeBandit(NIGHT_WINS);
    const svc = new BanditPlacer(
      makePrisma([
        { start: "2026-06-15T00:00:00.000Z", durationMinutes: 1380 }, // 00:00–23:00
      ]) as never,
      bandit as never,
      armStates as never,
    );
    const straddler = {
      id: "t1",
      durationMinutes: 90,
      deadline: new Date("2026-06-16T01:00:00.000Z"),
    };
    const pick = await svc.placeTask("u1", straddler, TZ, MATRIX, now);
    expect(pick).not.toBeNull();
    expect(pick!.scheduledStartTime.toISOString()).toBe(
      "2026-06-15T23:00:00.000Z",
    );
    expect(pick!.selectedArm).toBe("NIGHT");
  });

  it("returns null when /predict fails", async () => {
    const bandit = makeBandit(() => null);
    const svc = new BanditPlacer(
      makePrisma() as never,
      bandit as never,
      armStates as never,
    );
    expect(await svc.placeTask("u1", task, TZ, MATRIX, now)).toBeNull();
  });

  it("returns null when the whole horizon is occupied", async () => {
    const bandit = makeBandit(NIGHT_WINS);
    const sameDayTask = {
      id: "t1",
      durationMinutes: 60,
      deadline: new Date("2026-06-16T00:00:00.000Z"),
    };
    const svc = new BanditPlacer(
      makePrisma([
        { start: "2026-06-15T00:00:00.000Z", durationMinutes: 1440 },
      ]) as never,
      bandit as never,
      armStates as never,
    );
    expect(await svc.placeTask("u1", sameDayTask, TZ, MATRIX, now)).toBeNull();
  });

  it("returns null immediately when disabled", async () => {
    const bandit = { ...makeBandit(NIGHT_WINS), enabled: false };
    const svc = new BanditPlacer(
      makePrisma() as never,
      bandit as never,
      armStates as never,
    );
    expect(await svc.placeTask("u1", task, TZ, MATRIX, now)).toBeNull();
    expect(bandit.predict).not.toHaveBeenCalled();
  });
});
