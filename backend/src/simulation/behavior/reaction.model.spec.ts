import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { makeRng } from "../rng";
import type { Persona } from "../personas/persona.factory";
import type { PreferenceField } from "../personas/preference-field";
import { driftedFieldFor } from "../personas/preference-field";
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
    urgencySpikeProbPerTask: 0.01,
    urgencyMoveThreshold: 0.7,
    energyBaseline: 0.7,
    energySensitivity: 0.2,
    splitThresholdMinutes: 90,
    splitRate: 0.1,
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

  it("scores against the drifted field when one is supplied", () => {
    // Base peak at the 10:00 slot (feasible[1]); high edit propensity, no noise.
    // Un-drifted → the persona moves to feasible[1]. With a +4-block (one hour)
    // drift the peak slides to the 11:00 slot (feasible[2]), so the SAME persona
    // moves there instead — proving drift reaches the reaction loop.
    const p = persona({
      field: fieldPeakedAt(feasible[1]),
      editPropensity: 1,
      moveThreshold: 0.5,
      noiseFloor: 0,
    });

    const undrifted = decidePlacement(
      p,
      task(),
      suggested,
      feasible,
      makeRng(2),
    );
    expect(undrifted!.getTime()).toBe(feasible[1].getTime());

    // One 15-min slot = 1 block; one hour = 4 blocks. A +4-block shift moves the
    // peak forward from the 10:00 slot to the 11:00 slot.
    const drifted = driftedFieldFor(p.field, 4, 1);
    const moved = decidePlacement(
      p,
      task(),
      suggested,
      feasible,
      makeRng(2),
      drifted,
    );
    expect(moved!.getTime()).toBe(feasible[2].getTime());
  });

  it("defaults to the base field (zero drift is a no-op)", () => {
    const p = persona({
      field: fieldPeakedAt(feasible[2]),
      editPropensity: 1,
      moveThreshold: 0.5,
      noiseFloor: 0,
    });
    // Explicit zero-drift field === omitting the field argument.
    const zeroDrift = driftedFieldFor(p.field, 0.2, 0); // 0 months → same object
    expect(zeroDrift).toBe(p.field);
    const a = decidePlacement(p, task(), suggested, feasible, makeRng(2));
    const b = decidePlacement(
      p,
      task(),
      suggested,
      feasible,
      makeRng(2),
      zeroDrift,
    );
    expect(a!.getTime()).toBe(b!.getTime());
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

  it("high fatigue (low energy) raises reschedule rate vs low fatigue (high energy)", () => {
    // The runner passes `1 - energyT` as fatigue, so fatigue=0.9 means energyT=0.1
    // and fatigue=0.1 means energyT=0.9. The existing `reschedule += fatigue * 0.3`
    // logic ensures more reschedules when fatigued.
    const p = persona({
      discipline: { complete: 0.5, reschedule: 0.3, abandon: 0.2 },
    });
    const countReschedule = (fatigue: number) => {
      const rng = makeRng(12);
      let r = 0;
      for (let i = 0; i < 2000; i++) {
        if (
          decideOutcome(p, { deadline: null }, now, fatigue, rng) ===
          "reschedule"
        )
          r++;
      }
      return r;
    };
    expect(countReschedule(0.9)).toBeGreaterThan(countReschedule(0.1));
  });
});
