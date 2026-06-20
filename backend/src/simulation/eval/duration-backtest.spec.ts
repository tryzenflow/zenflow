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
    expect(r.medianEstError).toBe(30); // |90 − 60|
    expect(r.medianCorrectedErrorBlend).toBe(0); // correctDuration(60,1.5)=90
    expect(r.passesBlend).toBe(true);
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
    expect(r.medianCorrectedErrorBlend).toBe(r.medianEstError);
    expect(r.passesBlend).toBe(false); // strict <, equal does not pass
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
    expect(r.medianCorrectedErrorBlend).toBeLessThan(r.medianCorrectedErrorMax);
  });

  it("reports zero over an empty task set without throwing", () => {
    const r = durationBacktest([]);
    expect(r.tasks).toBe(0);
    expect(r.passesBlend).toBe(false);
  });
});
