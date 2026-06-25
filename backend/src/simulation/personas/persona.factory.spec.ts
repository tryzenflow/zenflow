import { buildPersonaRecord } from "./persona.factory";
import { archetypeById } from "./archetypes";

/**
 * Step-8 sensitivity knobs (run.ts `--noise-mult` / `--drift-mult`, threaded as
 * {@link SensitivityOpts}). These assert:
 *  - defaults (mult = 1.0 / omitted) reproduce today's draws EXACTLY,
 *  - the noise floor scales by the multiplier and stays clamped to [0, 1],
 *  - drift magnitude (peakShiftBlocks + biasDecay) scales linearly,
 *  - the multipliers DON'T perturb the RNG stream — only the resulting scalar is
 *    scaled, so every OTHER latent field is identical across multipliers.
 */

const SEED = 12345;
const INDEX = 0;
const SPAN = 60;

const build = (
  archetype: Parameters<typeof archetypeById>[0],
  sensitivity?: { noiseMult?: number; driftMult?: number },
) =>
  buildPersonaRecord(archetypeById(archetype), SEED, INDEX, SPAN, sensitivity)
    .persona;

describe("persona.factory sensitivity multipliers", () => {
  it("defaults (omitted) reproduce the unflagged draw byte-for-byte", () => {
    const base = build("dev");
    const explicitOnes = build("dev", { noiseMult: 1, driftMult: 1 });
    expect(explicitOnes.noiseFloor).toBe(base.noiseFloor);
    expect(explicitOnes.driftPerMonth).toEqual(base.driftPerMonth);
    // Every other latent field is identical too.
    expect(explicitOnes.editPropensity).toBe(base.editPropensity);
    expect(explicitOnes.moveThreshold).toBe(base.moveThreshold);
    expect(explicitOnes.discipline).toEqual(base.discipline);
  });

  it("scales the noise floor by --noise-mult", () => {
    const base = build("dev");
    const scaled = build("dev", { noiseMult: 1.5 });
    // dev's noise floor center is ~0.10 → 1.5× stays well under the [0,1] clamp.
    expect(scaled.noiseFloor).toBeCloseTo(base.noiseFloor * 1.5, 10);
  });

  it("clamps the scaled noise floor to [0, 1]", () => {
    // A huge multiplier must saturate at 1, not overflow.
    const scaled = build("ops", { noiseMult: 100 });
    expect(scaled.noiseFloor).toBeLessThanOrEqual(1);
    expect(scaled.noiseFloor).toBe(1);
    // A zero multiplier floors at 0.
    const zeroed = build("ops", { noiseMult: 0 });
    expect(zeroed.noiseFloor).toBe(0);
  });

  it("scales BOTH drift components by --drift-mult", () => {
    const base = build("dev");
    const scaled = build("dev", { driftMult: 2 });
    expect(scaled.driftPerMonth.peakShiftBlocks).toBeCloseTo(
      base.driftPerMonth.peakShiftBlocks * 2,
      10,
    );
    expect(scaled.driftPerMonth.biasDecay).toBeCloseTo(
      base.driftPerMonth.biasDecay * 2,
      10,
    );
  });

  it("does NOT perturb the RNG stream — other fields unchanged across multipliers", () => {
    const base = build("crammer");
    const noisy = build("crammer", { noiseMult: 2 });
    const drifty = build("crammer", { driftMult: 3 });
    for (const variant of [noisy, drifty]) {
      expect(variant.editPropensity).toBe(base.editPropensity);
      expect(variant.moveThreshold).toBe(base.moveThreshold);
      expect(variant.procrastination).toBe(base.procrastination);
      expect(variant.markCompleteRate).toBe(base.markCompleteRate);
      expect(variant.deadlineProb).toBe(base.deadlineProb);
      expect(variant.dailyVolume).toBe(base.dailyVolume);
      expect(variant.projectTags).toEqual(base.projectTags);
      expect(variant.idleWindows).toEqual(base.idleWindows);
      // New fields drawn after idleWindows are also unaffected by multipliers.
      expect(variant.urgencySpikeProbPerTask).toBe(
        base.urgencySpikeProbPerTask,
      );
      expect(variant.urgencyMoveThreshold).toBe(base.urgencyMoveThreshold);
      expect(variant.energyBaseline).toBe(base.energyBaseline);
      expect(variant.energySensitivity).toBe(base.energySensitivity);
      expect(variant.splitThresholdMinutes).toBe(base.splitThresholdMinutes);
      expect(variant.splitRate).toBe(base.splitRate);
    }
  });

  it("new fields are sampled in valid ranges for all archetypes", () => {
    for (const archetypeId of [
      "dev",
      "night_owl",
      "ops",
      "pm",
      "crammer",
    ] as const) {
      const p = build(archetypeId);
      expect(p.urgencySpikeProbPerTask).toBeGreaterThanOrEqual(0);
      expect(p.urgencySpikeProbPerTask).toBeLessThanOrEqual(1);
      expect(p.urgencyMoveThreshold).toBeGreaterThanOrEqual(0);
      expect(p.urgencyMoveThreshold).toBeLessThanOrEqual(1);
      expect(p.energyBaseline).toBeGreaterThanOrEqual(0.1);
      expect(p.energyBaseline).toBeLessThanOrEqual(1);
      expect(p.energySensitivity).toBeGreaterThanOrEqual(0);
      expect(p.splitThresholdMinutes).toBeGreaterThan(0);
      expect(p.splitRate).toBeGreaterThanOrEqual(0);
      expect(p.splitRate).toBeLessThanOrEqual(1);
    }
  });

  it("splitThresholdMinutes is fixed per archetype (not jittered per persona)", () => {
    // splitThresholdMinutes comes directly from the archetype, not a RNG draw.
    const p1 = build("dev", undefined);
    const p2 = build("dev", { noiseMult: 2 });
    // Different seeds → different personas, but same archetype threshold.
    expect(p1.splitThresholdMinutes).toBe(p2.splitThresholdMinutes);
    expect(p1.splitThresholdMinutes).toBe(90); // dev archetype value
    expect(build("crammer").splitThresholdMinutes).toBe(60); // crammer value
  });
});
