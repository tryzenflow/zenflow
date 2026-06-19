import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { makeRng } from "../rng";
import type { Persona } from "../personas/persona.factory";
import type { PreferenceField } from "../personas/preference-field";
import { preferenceIndex } from "../../scheduler/slot";
import {
  decideOutcome,
  decidePlacement,
  decideResize,
  type ReactionTask,
} from "./reaction.model";

/**
 * The reaction policy must (a) only ever return a slot from the EDF feasible set
 * — the feasibility wall (strategy §2) — and (b) honour the noise floor: a
 * zero-noise, zero-edit persona never moves; a high-noise persona sometimes acts
 * out of character. These are the invariants the rest of the study rests on.
 */

const UTC = "UTC";

/** A field with a single sharp preference peak at a chosen instant. */
function fieldPeakedAt(peakSlot: Date, procrastination = 0): PreferenceField {
  const pGlobal = new Float64Array(PREFERENCE_MATRIX_LENGTH);
  pGlobal[preferenceIndex(peakSlot, UTC)] = 10;
  return { pGlobal, pTag: new Map(), procrastination };
}

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    userId: "u1",
    archetypeId: "dev",
    index: 0,
    prefs: {
      workStart: 540,
      workEnd: 1020,
      workDays: [1, 2, 3, 4, 5],
      timezone: UTC,
    },
    field: {
      pGlobal: new Float64Array(PREFERENCE_MATRIX_LENGTH),
      pTag: new Map(),
      procrastination: 0,
    },
    tagBias: new Map(),
    editPropensity: 1,
    moveThreshold: 0.5,
    noiseFloor: 0,
    procrastination: 0,
    discipline: { complete: 0.8, reschedule: 0.15, abandon: 0.05 },
    markCompleteRate: 1,
    projectTags: [],
    deadlineProb: 0.4,
    dailyVolume: 3,
    viewWeights: { day: 0.5, week: 0.4, month: 0.1 },
    estDuration: { mu: Math.log(60), sigma: 0.4 },
    fixedLoadPerWeek: 3,
    driftPerMonth: { peakShiftBlocks: 0, biasDecay: 0 },
    tagMix: [{ name: "backend", weight: 1 }],
    idleWindows: [],
    ...overrides,
  };
}

const task = (over: Partial<ReactionTask> = {}): ReactionTask => ({
  tags: ["backend"],
  deadline: null,
  durationMinutes: 60,
  trueDurationMinutes: 60,
  ...over,
});

describe("decidePlacement", () => {
  // Three feasible Monday slots, 09:00 / 10:00 / 11:00 UTC.
  const feasible = [
    new Date("2025-01-06T09:00:00.000Z"),
    new Date("2025-01-06T10:00:00.000Z"),
    new Date("2025-01-06T11:00:00.000Z"),
  ];
  const suggested = feasible[0];

  it("only ever returns a slot from the feasible set (or null = KEEP)", () => {
    const p = persona({ field: fieldPeakedAt(feasible[2]) });
    const rng = makeRng(1);
    for (let i = 0; i < 500; i++) {
      const move = decidePlacement(p, task(), suggested, feasible, rng);
      if (move !== null) {
        expect(feasible.some((c) => c.getTime() === move.getTime())).toBe(true);
      }
    }
  });

  it("moves toward the preferred feasible slot when the gap clears the threshold", () => {
    // Peak at the third slot; high edit propensity, no noise → should move there.
    const p = persona({
      field: fieldPeakedAt(feasible[2]),
      editPropensity: 1,
      moveThreshold: 0.5,
      noiseFloor: 0,
    });
    const rng = makeRng(2);
    const move = decidePlacement(p, task(), suggested, feasible, rng);
    expect(move).not.toBeNull();
    expect(move!.getTime()).toBe(feasible[2].getTime());
  });

  it("KEEPs when the preference field is flat (no gap beats the threshold)", () => {
    const p = persona({ moveThreshold: 1.0, noiseFloor: 0 });
    const rng = makeRng(3);
    let moves = 0;
    for (let i = 0; i < 200; i++) {
      if (decidePlacement(p, task(), suggested, feasible, rng)) moves++;
    }
    // Flat field + small argmax jitter rarely clears a 1.0 threshold.
    expect(moves).toBe(0);
  });

  it("never moves when editPropensity is 0", () => {
    const p = persona({
      field: fieldPeakedAt(feasible[2]),
      editPropensity: 0,
      noiseFloor: 0,
    });
    const rng = makeRng(4);
    for (let i = 0; i < 200; i++) {
      expect(decidePlacement(p, task(), suggested, feasible, rng)).toBeNull();
    }
  });

  it("returns null on an empty feasible set", () => {
    const p = persona();
    expect(decidePlacement(p, task(), suggested, [], makeRng(5))).toBeNull();
  });

  it("noise floor of 1 acts out of character but stays in the feasible set", () => {
    const p = persona({ noiseFloor: 1, field: fieldPeakedAt(feasible[0]) });
    const rng = makeRng(6);
    let moved = 0;
    for (let i = 0; i < 300; i++) {
      const m = decidePlacement(p, task(), suggested, feasible, rng);
      if (m) {
        moved++;
        expect(feasible.some((c) => c.getTime() === m.getTime())).toBe(true);
      }
    }
    // With pure noise it should sometimes pick a non-suggested slot.
    expect(moved).toBeGreaterThan(0);
  });
});

describe("decideResize", () => {
  it("does not resize when the mismatch is under one slot", () => {
    const p = persona({ editPropensity: 1 });
    const rng = makeRng(7);
    expect(
      decideResize(
        p,
        task({ durationMinutes: 60, trueDurationMinutes: 70 }),
        rng,
      ),
    ).toBeNull();
  });

  it("resizes to the true duration when the mismatch exceeds a slot", () => {
    const p = persona({ editPropensity: 1 });
    const rng = makeRng(8);
    expect(
      decideResize(
        p,
        task({ durationMinutes: 60, trueDurationMinutes: 120 }),
        rng,
      ),
    ).toBe(120);
  });

  it("never resizes when editPropensity is 0", () => {
    const p = persona({ editPropensity: 0 });
    const rng = makeRng(9);
    expect(
      decideResize(
        p,
        task({ durationMinutes: 60, trueDurationMinutes: 240 }),
        rng,
      ),
    ).toBeNull();
  });
});

describe("decideOutcome", () => {
  const now = new Date("2025-01-06T12:00:00.000Z");

  it("returns a valid outcome label", () => {
    const p = persona();
    const rng = makeRng(10);
    for (let i = 0; i < 100; i++) {
      const o = decideOutcome(p, { deadline: null }, now, 0, rng);
      expect(["complete", "reschedule", "abandon"]).toContain(o);
    }
  });

  it("raises completion under deadline crunch", () => {
    const p = persona({
      discipline: { complete: 0.4, reschedule: 0.4, abandon: 0.2 },
    });
    const soon = new Date(now.getTime() + 60 * 60 * 1000); // 1h away
    const far = new Date(now.getTime() + 240 * 60 * 60 * 1000); // far
    const countComplete = (deadline: Date) => {
      const rng = makeRng(11);
      let c = 0;
      for (let i = 0; i < 2000; i++) {
        if (decideOutcome(p, { deadline }, now, 0, rng) === "complete") c++;
      }
      return c;
    };
    expect(countComplete(soon)).toBeGreaterThan(countComplete(far));
  });
});
