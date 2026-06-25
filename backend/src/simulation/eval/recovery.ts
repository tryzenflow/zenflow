import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { SimulationModule } from "../simulation.module";
import { PrismaService } from "../../prisma/prisma.service";
import { reconstructUserMatrices } from "./replay";
import { aggregateTagBias } from "./tag-bias";
import { groundTruthPath, loadGroundTruthFile } from "./ground-truth";
import type { GroundTruthFile } from "./ground-truth";
import { durationRecovery, placementRecovery } from "./recovery-metrics";

/**
 * Ground-truth RECOVERY scoring entry point (phase-2-evaluation-steps §Step 6,
 * ADR-0001 §5). The simulation-only luxury: because the generator WROTE DOWN each
 * persona's hidden fields to a sidecar, we can check whether the Phase-2 learners
 * recovered the RIGHT thing, not just that MAR dropped — does the signed matrix
 * converge toward `pGlobal`, do the per-tag biases approach `b_tag`.
 *
 * The scoring MATH lives in `recovery-metrics.ts` (pure, unit-tested); this file
 * is the I/O wrapper that reconstructs each user's matrix + per-tag bias from the
 * frozen telemetry and scores them against the Step-0 sidecar. A MAR drop NOT
 * accompanied by better recovery is a red flag (Step 6) — this is the tool that
 * catches it.
 */

export interface RecoveryReport {
  personas: number;
  /** Mean over personas of the normalized matrix↔pGlobal distance (↓ better). */
  placementDistanceMean: number;
  /** Mean cosine similarity matrix↔pGlobal (↑ better). */
  placementCosineMean: number;
  /** Mean over personas of the per-tag bias MAE (↓ better). */
  durationBiasMaeMean: number;
  perPersona: {
    userId: string;
    placementDistance: number;
    placementCosine: number;
    durationBiasMae: number;
    durationTagsScored: number;
  }[];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Score recovery across the population: reconstruct each user's matrix + per-tag
 * bias from the frozen telemetry, compare to the sidecar ground truth.
 */
export async function scoreRecovery(
  prisma: PrismaService,
  ground: GroundTruthFile,
): Promise<RecoveryReport> {
  const matrices = await reconstructUserMatrices(prisma);

  // Per-user telemetry for the duration estimate.
  const events = await prisma.taskEvent.findMany({
    where: { eventType: { in: ["CREATE", "RESIZE", "KEEP", "COMPLETE"] } },
    orderBy: { occurredAt: "asc" },
    select: { userId: true, eventType: true, taskId: true, newSnapshot: true },
  });
  const byUser = new Map<string, typeof events>();
  for (const e of events) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  const perPersona: RecoveryReport["perPersona"] = [];
  for (const gt of ground.personas) {
    const learned =
      matrices.get(gt.userId)?.matrix ??
      new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    const place = placementRecovery(learned, gt.pGlobal);

    const userEvents = (byUser.get(gt.userId) ?? []).map((e) => ({
      eventType: e.eventType,
      taskId: e.taskId,
      newSnapshot: e.newSnapshot as {
        durationMinutes?: number;
        tags?: string[];
      } | null,
    }));
    const estBias = aggregateTagBias(userEvents);
    const dur = durationRecovery(estBias, gt.tagBias);

    perPersona.push({
      userId: gt.userId,
      placementDistance: place.distance,
      placementCosine: place.cosine,
      durationBiasMae: dur.mae,
      durationTagsScored: dur.tags,
    });
  }

  return {
    personas: perPersona.length,
    placementDistanceMean: mean(perPersona.map((p) => p.placementDistance)),
    placementCosineMean: mean(perPersona.map((p) => p.placementCosine)),
    durationBiasMaeMean: mean(perPersona.map((p) => p.durationBiasMae)),
    perPersona,
  };
}

/**
 * `sim:recovery` entry point. Loads the Step-0 sidecar for `--seed`/`--days`
 * (defaults match `sim:run`), scores recovery against the current sim DB, and
 * prints a JSON report.
 */
async function main(): Promise<void> {
  const logger = new Logger("sim:recovery");
  const get = (name: string): string | undefined => {
    const pref = `--${name}=`;
    const hit = process.argv.slice(2).find((a) => a.startsWith(pref));
    return hit ? hit.slice(pref.length) : undefined;
  };
  const seed = Number(get("seed") ?? 1);
  const days = Number(get("days") ?? 365);
  const path = get("ground-truth") ?? groundTruthPath(seed, days);

  const app = await NestFactory.createApplicationContext(SimulationModule, {
    logger: ["log", "warn", "error"],
  });
  try {
    const prisma = app.get(PrismaService);
    const ground = await loadGroundTruthFile(path);
    const report = await scoreRecovery(prisma, ground);
    logger.log(
      `Recovery (n=${report.personas}): placement dist mean=${report.placementDistanceMean.toFixed(
        4,
      )} cosine mean=${report.placementCosineMean.toFixed(
        4,
      )}, duration bias MAE mean=${report.durationBiasMaeMean.toFixed(4)}`,
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
