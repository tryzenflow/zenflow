import { basename, join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { SimulationModule } from "./simulation.module";
import { TasksService } from "../tasks/tasks.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { AbandonedTasksService } from "../scheduler/abandoned-tasks.service";
import { PrismaService } from "../prisma/prisma.service";
import { runSimulation, type RunOptions, type SimMode } from "./runner";
import { groundTruthPath, writeGroundTruthFile } from "./eval/ground-truth";

/**
 * Entry point: boot a STANDALONE Nest context (no HTTP), resolve the real
 * providers, parse CLI args, run the closed loop, then close.
 *
 * Args (all optional): `--seed=<int>`, `--start=YYYY-MM-DD`, `--days=<int>`,
 * `--reranker=identity|phase2`, `--personas=<int>` (cap, for smoke runs),
 * `--personas-per-cohort=<int>` (keep the FIRST N personas of EACH archetype, so
 * every cohort survives a shrunken population — Step 6/7 need all 5 cohorts;
 * a plain `--personas` cap slices the flat list and would drop later cohorts),
 * `--concurrency=<int>` (service-mode personas in parallel; default 8),
 * `--mode=batched|service` (persistence strategy; default batched: compute the
 * whole population in memory, then bulk-write in 50k-row batches).
 *
 * Step-8 ablation / sensitivity knobs (defaults reproduce today's behavior EXACTLY):
 *   `--duration-bias=blend|max` (default `blend`) — multi-tag duration resolution:
 *     `blend` = sample-weighted blend (default); `max` = Conservative Max-Bias.
 *   `--noise-mult=<float>` (default `1.0`) — scales each persona's noise floor ε.
 *   `--drift-mult=<float>`  (default `1.0`) — scales drift magnitude (peak shift +
 *     bias decay per month).
 *
 * Determinism: every random draw flows from the seeded PRNG; the start date is
 * supplied here so the timeline is reproducible. Run against the dedicated sim
 * DB only (`dotenv -e .env.sim`).
 *
 * Env (optional): `SIM_OUTPUT_DIR` overrides where the ground-truth sidecar is
 * written (default `<cwd>/sim-output`). The parallel multi-arm driver
 * (`scripts/sim-arms.sh`) sets a distinct dir per arm so arms that share
 * `--seed`/`--days` don't clobber each other's sidecar; the eval reads from the
 * same dir. `DATABASE_URL` (already the sim DB selector) is overridden per arm so
 * each arm targets its OWN database and they can run concurrently.
 */

import type { DurationBiasMode, RerankerKind } from "./runner";

interface ParsedArgs {
  seed: number;
  start: string;
  days: number;
  reranker: RerankerKind;
  personaLimit?: number;
  perCohortLimit?: number;
  concurrency: number;
  mode: SimMode;
  durationBias: DurationBiasMode;
  noiseMult: number;
  driftMult: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (name: string): string | undefined => {
    const pref = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(pref));
    return hit ? hit.slice(pref.length) : undefined;
  };
  const seed = Number(get("seed") ?? 1);
  const start = get("start") ?? "2025-01-06"; // a Monday
  const days = Number(get("days") ?? 365);
  const rerankerArg = get("reranker") ?? "identity";
  const personasArg = get("personas");
  const personaLimit = personasArg ? Number(personasArg) : undefined;
  const perCohortArg = get("personas-per-cohort");
  const perCohortLimit = perCohortArg ? Number(perCohortArg) : undefined;
  const concurrency = Number(get("concurrency") ?? 8);
  const modeArg = get("mode") ?? "batched";
  if (modeArg !== "batched" && modeArg !== "service")
    throw new Error(`--mode must be 'batched' or 'service' (got '${modeArg}')`);
  const mode = modeArg satisfies SimMode;

  if (rerankerArg !== "identity" && rerankerArg !== "phase2") {
    throw new Error(
      `--reranker must be 'identity' or 'phase2' (got '${rerankerArg}').`,
    );
  }
  const reranker: RerankerKind = rerankerArg;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start))
    throw new Error(`--start must be YYYY-MM-DD (got '${start}')`);

  // ── Step-8 ablation / sensitivity knobs (defaults reproduce today exactly) ──
  const durationBiasArg = get("duration-bias") ?? "blend";
  if (durationBiasArg !== "blend" && durationBiasArg !== "max")
    throw new Error(
      `--duration-bias must be 'blend' or 'max' (got '${durationBiasArg}')`,
    );
  const durationBias: DurationBiasMode = durationBiasArg;
  const noiseMult = Number(get("noise-mult") ?? 1);
  const driftMult = Number(get("drift-mult") ?? 1);
  if (!(noiseMult >= 0) || !Number.isFinite(noiseMult))
    throw new Error(
      `--noise-mult must be a finite number ≥ 0 (got '${noiseMult}')`,
    );
  if (!Number.isFinite(driftMult))
    throw new Error(
      `--drift-mult must be a finite number (got '${driftMult}')`,
    );

  return {
    seed,
    start,
    days,
    reranker,
    personaLimit,
    perCohortLimit,
    concurrency,
    mode,
    durationBias,
    noiseMult,
    driftMult,
  };
}

async function main(): Promise<void> {
  const logger = new Logger("sim:run");
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(SimulationModule, {
    logger: ["log", "warn", "error"],
  });
  try {
    const opts: RunOptions = {
      tasks: app.get(TasksService),
      scheduler: app.get(SchedulerService),
      abandoned: app.get(AbandonedTasksService),
      prisma: app.get(PrismaService),
      ...args,
    };
    const result = await runSimulation(opts);
    logger.log(
      `Seeded ${result.personas.length} personas; event totals: ${JSON.stringify(result.eventCounts)}`,
    );

    // Write the ground-truth sidecar (eval Step 0) keyed by the real userIds this
    // run minted — the out-of-band channel the recovery metrics read.
    //
    // Parallel multi-arm runs share the same `--seed`/`--days`, so the default
    // `ground-truth-seed{seed}-days{days}.json` filename would collide across arms
    // and the last writer would clobber the rest. `SIM_OUTPUT_DIR` lets the
    // multi-arm driver point each arm at its OWN sidecar directory (one per DB),
    // keeping the sidecars isolated WITHOUT touching `eval/*` — the eval reader is
    // pointed at the matching directory the same way. Unset ⇒ today's
    // `<cwd>/sim-output` path, so single-DB `sim:run` is byte-for-byte unchanged.
    const outDir = process.env.SIM_OUTPUT_DIR;
    const defaultPath = groundTruthPath(args.seed, args.days);
    const gtTarget = outDir ? join(outDir, basename(defaultPath)) : defaultPath;
    const gtPath = await writeGroundTruthFile(gtTarget, {
      meta: {
        seed: args.seed,
        start: args.start,
        days: args.days,
        mode: args.mode,
        personas: result.groundTruth.length,
        kind: "phase-2-ground-truth",
      },
      personas: result.groundTruth,
    });
    logger.log(`Ground-truth sidecar written: ${gtPath}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
