import { durationBacktest, type BacktestTask } from "./duration-backtest";
import type { TagBias } from "../../scheduler/duration-bias";

const table = (entries: Record<string, TagBias>): Map<string, TagBias> =>
  new Map(Object.entries(entries));

describe("durationBacktest", () => {
  it("passes when the learned bias moves corrected toward true", () => {
    // est=60, true=90 → user underestimates 1.5×; learned bias ~1.5 corrects it.
    const tasks: BacktestTask[] = [
      {
        estimated: 60,
        trueDuration: 90,
        tags: ["writing"],
        perTag: table({ writing: { n: 20, b: 1.5 } }),
      },
    ];
    const r = durationBacktest(tasks);
    expect(r.meanEstError).toBe(30); // |90 − 60|
    expect(r.meanCorrectedErrorBlend).toBe(0); // correctDuration(60,1.5)=90
    expect(r.fractionImprovedBlend).toBe(1);
    expect(r.meanReductionBlend).toBe(1); // full reduction
    expect(r.passesBlend).toBe(true);
    // Median is still reported, just not the deciding gate.
    expect(r.medianEstError).toBe(30);
  });

  it("does not pass when there is no bias to learn (corrected == est)", () => {
    const tasks: BacktestTask[] = [
      {
        estimated: 60,
        trueDuration: 90,
        tags: ["x"],
        perTag: table({}), // no evidence → NEUTRAL_BIAS (1.0)
      },
    ];
    const r = durationBacktest(tasks);
    expect(r.meanCorrectedErrorBlend).toBe(r.meanEstError);
    expect(r.fractionImprovedBlend).toBe(0);
    expect(r.meanReductionBlend).toBe(0);
    expect(r.passesBlend).toBe(false); // strict <, equal does not pass
  });

  it("gates on the MEAN even when the median is pinned at the grid floor", () => {
    // Most tasks already sit at the grid floor (true == est → 0 error), so the
    // median |true − est| is 0 for BOTH est and corrected and can never decide.
    // A heavy-tailed minority is badly under-estimated and the learned 2× bias
    // fixes them — only the MEAN statistic registers that win.
    const pinned: BacktestTask[] = Array.from({ length: 8 }, () => ({
      estimated: 60,
      trueDuration: 60, // grid-floor, zero error both ways
      tags: ["calls"],
      perTag: table({ calls: { n: 30, b: 1.0 } }),
    }));
    const tail: BacktestTask[] = Array.from({ length: 2 }, () => ({
      estimated: 60,
      trueDuration: 120, // under-estimated 2×
      tags: ["deep"],
      perTag: table({ deep: { n: 30, b: 2.0 } }),
    }));
    const r = durationBacktest([...pinned, ...tail]);
    // Median is grid-floor-pinned and identical → would (wrongly) NOT pass.
    expect(r.medianEstError).toBe(0);
    expect(r.medianCorrectedErrorBlend).toBe(0);
    // But the MEAN drops (60 of error removed over 10 tasks) → gate PASSES.
    expect(r.meanCorrectedErrorBlend).toBeLessThan(r.meanEstError);
    expect(r.meanReductionBlend).toBeGreaterThan(0);
    expect(r.fractionImprovedBlend).toBeCloseTo(0.2); // the 2 tail tasks
    expect(r.passesBlend).toBe(true);
  });

  it("reports a trimmed mean that ignores a single pathological outlier", () => {
    // Nine well-behaved tasks plus one extreme outlier: the trimmed mean is
    // strictly below the plain mean because the outlier is clipped off the tail.
    const normal: BacktestTask[] = Array.from({ length: 9 }, () => ({
      estimated: 60,
      trueDuration: 75, // 15 min error each
      tags: ["x"],
      perTag: table({}),
    }));
    const outlier: BacktestTask = {
      estimated: 60,
      trueDuration: 600, // huge error
      tags: ["x"],
      perTag: table({}),
    };
    const r = durationBacktest([...normal, outlier]);
    expect(r.trimmedMeanEstError).toBeLessThan(r.meanEstError);
  });

  it("blend beats max when one tag is a high-variance outlier (ops-like)", () => {
    // A task tagged [ops, incident]: ops near-unbiased (b≈1.0, many samples),
    // incident a one-off high multiplier (b=1.8, n=1). True ≈ est (unbiased).
    // Blend stays near 1.0 (low error); max-bias jumps to 1.8 (over-reserves).
    const perTag = table({
      ops: { n: 40, b: 1.0 },
      incident: { n: 1, b: 1.8 },
    });
    const tasks: BacktestTask[] = [
      { estimated: 60, trueDuration: 60, tags: ["ops", "incident"], perTag },
    ];
    const r = durationBacktest(tasks);
    expect(r.meanCorrectedErrorBlend).toBeLessThan(r.meanCorrectedErrorMax);
  });

  it("reports zero over an empty task set without throwing", () => {
    const r = durationBacktest([]);
    expect(r.tasks).toBe(0);
    expect(r.meanEstError).toBe(0);
    expect(r.fractionImprovedBlend).toBe(0);
    expect(r.passesBlend).toBe(false);
  });
});
