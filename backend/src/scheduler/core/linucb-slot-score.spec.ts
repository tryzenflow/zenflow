import { linucbSlotScore } from "./linucb-slot-score";
import { matrixIndex } from "./preference";

const TZ = "UTC";
const MON = "2026-06-15";
const TUE = "2026-06-16";
const ms = (day: string, hhmm: string) =>
  new Date(`${day}T${hhmm}:00.000Z`).getTime();
const ZERO = new Array<number>(168).fill(0);

describe("linucbSlotScore", () => {
  it("sums Σ_arm overlapRate·predicted plus the overlap-weighted preference score", () => {
    // 19:00–21:00 → 0.5 EVENING + 0.5 NIGHT. predicted EVENING 2, NIGHT 4.
    // arm term = 0.5·2 + 0.5·4 = 3. pref: hour 19 = 1, hour 20 = 1 → 1·1 + 1·1 = 2.
    const pref = [...ZERO];
    pref[matrixIndex(1, 19)] = 1;
    pref[matrixIndex(1, 20)] = 1;
    const { score, topArm } = linucbSlotScore({
      startMs: ms(MON, "19:00"),
      endMs: ms(MON, "21:00"),
      timezone: TZ,
      armScores: { EVENING: 2, NIGHT: 4 },
      prefMatrix: pref,
    });
    expect(score).toBeCloseTo(5);
    // NIGHT term (0.5·4 = 2) beats EVENING term (0.5·2 = 1).
    expect(topArm).toBe("NIGHT");
  });

  it("falls back to the preference score alone when every arm is cold (predicted 0)", () => {
    const pref = [...ZERO];
    pref[matrixIndex(1, 9)] = 3; // 09:00 hour strongly preferred
    const cold = linucbSlotScore({
      startMs: ms(MON, "09:00"),
      endMs: ms(MON, "10:00"),
      timezone: TZ,
      armScores: {}, // nothing learned yet
      prefMatrix: pref,
    });
    const neutral = linucbSlotScore({
      startMs: ms(MON, "12:00"),
      endMs: ms(MON, "13:00"),
      timezone: TZ,
      armScores: {},
      prefMatrix: pref,
    });
    expect(cold.score).toBeCloseTo(3);
    expect(neutral.score).toBeCloseTo(0);
    expect(cold.score).toBeGreaterThan(neutral.score);
  });

  it("lets the preference addend flip the winner between two equal-arm slots", () => {
    // Both slots are fully inside AFTERNOON (predicted 1) → equal arm term.
    // Only the second overlaps a preferred hour, so it must score higher.
    const pref = [...ZERO];
    pref[matrixIndex(1, 15)] = 5;
    const plain = linucbSlotScore({
      startMs: ms(MON, "12:00"),
      endMs: ms(MON, "13:00"),
      timezone: TZ,
      armScores: { AFTERNOON: 1 },
      prefMatrix: pref,
    });
    const preferred = linucbSlotScore({
      startMs: ms(MON, "15:00"),
      endMs: ms(MON, "16:00"),
      timezone: TZ,
      armScores: { AFTERNOON: 1 },
      prefMatrix: pref,
    });
    expect(plain.score).toBeCloseTo(1);
    expect(preferred.score).toBeCloseTo(6);
  });

  it("scores a midnight-spanning slot across both days' arms and hour rows (D5)", () => {
    const pref = [...ZERO];
    pref[matrixIndex(1, 23)] = 2; // Mon 23:00
    pref[matrixIndex(2, 0)] = 2; // Tue 00:00
    // 23:00–01:00 (2h) → 0.5 NIGHT (Mon) + 0.5 EARLY_MORNING (Tue).
    // arm term = 0.5·NIGHT(10) + 0.5·EARLY_MORNING(6) = 5 + 3 = 8.
    // pref: full hour 23 Mon (1·2) + full hour 00 Tue (1·2) = 4. total 12.
    const { score, topArm } = linucbSlotScore({
      startMs: ms(MON, "23:00"),
      endMs: ms(TUE, "01:00"),
      timezone: TZ,
      armScores: { NIGHT: 10, EARLY_MORNING: 6 },
      prefMatrix: pref,
    });
    expect(score).toBeCloseTo(12);
    expect(topArm).toBe("NIGHT");
  });

  it("scores a slot closer to prevStartMs higher than a farther one, all else equal (stability sign regression)", () => {
    // Flat arm scores and flat preference matrix, so the only thing that can
    // differ between the two candidates is the stability term. Before the
    // fix, `stabilityScore` returned a positive, growing-with-distance value
    // that got ADDED to the score — rewarding the farther slot. It must now
    // reward the closer one instead.
    const prevStartMs = ms(MON, "09:00");
    const closer = linucbSlotScore({
      startMs: ms(MON, "10:00"), // 1h from prevStartMs
      endMs: ms(MON, "11:00"),
      timezone: TZ,
      armScores: { MORNING: 1 },
      prefMatrix: ZERO,
      prevStartMs,
    });
    const farther = linucbSlotScore({
      startMs: ms(MON, "14:00"), // 5h from prevStartMs
      endMs: ms(MON, "15:00"),
      timezone: TZ,
      armScores: { AFTERNOON: 1 },
      prefMatrix: ZERO,
      prevStartMs,
    });
    expect(closer.score).toBeGreaterThan(farther.score);
  });

  it("the stability term never outweighs a real arm-score difference", () => {
    const prevStartMs = ms(MON, "09:00");
    // Far from prevStartMs but a much better-learned arm.
    const farButBetterArm = linucbSlotScore({
      startMs: ms(MON, "18:00"),
      endMs: ms(MON, "19:00"),
      timezone: TZ,
      armScores: { EVENING: 5 },
      prefMatrix: ZERO,
      prevStartMs,
    });
    // Right at prevStartMs but a cold/unlearned arm.
    const closeButColdArm = linucbSlotScore({
      startMs: ms(MON, "09:00"),
      endMs: ms(MON, "10:00"),
      timezone: TZ,
      armScores: {},
      prefMatrix: ZERO,
      prevStartMs,
    });
    expect(farButBetterArm.score).toBeGreaterThan(closeButColdArm.score);
  });
});
