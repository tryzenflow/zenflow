import {
  PREFERENCE_MATRIX_LENGTH,
  PREFERENCE_SLOTS_PER_DAY,
} from "@zenflow/shared";
import { driftPGlobal, driftedFieldFor } from "./preference-field";
import type { PreferenceField } from "./preference-field";

/**
 * The drift helpers are pure (no RNG, no clock) and now LIVE in the reaction
 * loop (`runner.ts` advances the field by the elapsed months at each placement
 * decision), so they carry their own unit coverage per the pure-core contract.
 */

const SLOTS = PREFERENCE_SLOTS_PER_DAY; // 24

function peakedAt(day: number, block: number): Float64Array {
  const g = new Float64Array(PREFERENCE_MATRIX_LENGTH);
  g[(day - 1) * SLOTS + block] = 10;
  return g;
}

function field(pGlobal: Float64Array): PreferenceField {
  return { pGlobal, pTag: new Map(), procrastination: 0 };
}

describe("driftPGlobal", () => {
  it("slides the peak forward along the slot-of-day axis", () => {
    const g = peakedAt(1, 10); // Monday, block 10 (10:00)
    const out = driftPGlobal(g, 4); // +4 blocks
    expect(out[10]).toBe(0);
    expect(out[14]).toBe(10);
  });

  it("returns the same array when the shift is zero", () => {
    const g = peakedAt(1, 10);
    expect(driftPGlobal(g, 0)).toBe(g);
  });

  it("wraps the slot axis circularly without leaking across days", () => {
    const g = peakedAt(2, 1); // Tuesday, block 1
    const out = driftPGlobal(g, -4); // shift back, wraps to end-of-day
    const base = SLOTS; // Tuesday base
    expect(out[base + ((1 - 4 + SLOTS) % SLOTS)]).toBe(10);
    // Monday (day 1) stays empty — the wrap is within the day, not across days.
    for (let s = 0; s < SLOTS; s++) expect(out[s]).toBe(0);
  });
});

describe("driftedFieldFor", () => {
  it("returns the SAME field object when net shift rounds to zero", () => {
    const f = field(peakedAt(1, 10));
    expect(driftedFieldFor(f, 0, 5)).toBe(f); // no per-month drift
    expect(driftedFieldFor(f, 0.2, 0)).toBe(f); // zero months elapsed
  });

  it("drifts pGlobal by peakShiftBlocks × monthsElapsed", () => {
    const f = field(peakedAt(1, 10));
    // 2 blocks/month × 2 months = +4 blocks.
    const drifted = driftedFieldFor(f, 2, 2);
    expect(drifted).not.toBe(f);
    expect(drifted.pGlobal[14]).toBe(10);
    expect(drifted.pGlobal[10]).toBe(0);
    // pTag + procrastination pass through unchanged.
    expect(drifted.pTag).toBe(f.pTag);
    expect(drifted.procrastination).toBe(f.procrastination);
  });
});
