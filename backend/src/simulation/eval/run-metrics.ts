import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { SimulationModule } from "../simulation.module";
import { PrismaService } from "../../prisma/prisma.service";
import { computeMetrics } from "./metrics";
import { replayPhase2 } from "./replay";
import { scoreDurationBacktest } from "./duration-backtest";

/**
 * `sim:eval` entry point: boot a standalone Nest context against the sim DB,
 * compute the §12 metrics from the `TaskEvent` log, and run the offline-replay
 * propensity sanity-check (identity vs identity → ratio ≈ 1). Prints a JSON
 * report; a future ml-engineer plugs a real candidate re-ranker into the replay.
 */
async function main(): Promise<void> {
  const logger = new Logger("sim:eval");
  const app = await NestFactory.createApplicationContext(SimulationModule, {
    logger: ["log", "warn", "error"],
  });
  try {
    const prisma = app.get(PrismaService);

    const report = await computeMetrics(prisma);
    logger.log(
      `Aggregate (n=${report.aggregate.personas}): MAR mean=${report.aggregate.marMean.toFixed(3)} median=${report.aggregate.marMedian.toFixed(3)}, completion-in-slot=${report.aggregate.completionInSlotMean.toFixed(3)}, move-dist median=${report.aggregate.moveDistanceMedianMin.toFixed(0)}min, dur-error median=${report.aggregate.durationErrorMedianMin.toFixed(0)}min`,
    );

    // Offline gate (Step 4): replay BOTH the identity incumbent (sanity-check,
    // ratio ≈ 1) and the Phase-2 candidate reconstructed from the frozen log. The
    // Phase-2 SNIPS clearing the identity SNIPS is the cheap pre-filter before the
    // closed-loop A/B.
    const replay = await replayPhase2(prisma);
    logger.log(
      `Offline replay — identity: IPS=${replay.identity.ips.toFixed(3)} SNIPS=${replay.identity.snips.toFixed(3)} | ` +
        `phase2: IPS=${replay.phase2.ips.toFixed(3)} SNIPS=${replay.phase2.snips.toFixed(3)} over ${replay.phase2.decisions} decisions`,
    );

    // Offline gate (Step 4) — duration backtest: recompute the bias-corrected
    // duration for every historical task from THIS log and gate on
    // median|true − corrected| < median|true − est| (heuristic §Phase 2).
    const durationBacktest = await scoreDurationBacktest(prisma);
    logger.log(
      `Duration backtest (n=${durationBacktest.tasks}): median|true−est|=${durationBacktest.medianEstError.toFixed(
        1,
      )}min, |true−corrected| blend=${durationBacktest.medianCorrectedErrorBlend.toFixed(
        1,
      )}min max=${durationBacktest.medianCorrectedErrorMax.toFixed(1)}min → ` +
        `gate ${durationBacktest.passesBlend ? "PASS" : "FAIL"} (blend)`,
    );

    // Full machine-readable dump.

    console.log(
      JSON.stringify({ metrics: report, replay, durationBacktest }, null, 2),
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
