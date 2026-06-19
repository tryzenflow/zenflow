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
 * `--reranker=identity`, `--personas=<int>` (cap, for smoke runs),
 * `--concurrency=<int>` (service-mode personas in parallel; default 8),
 * `--mode=batched|service` (persistence strategy; default batched: compute the
 * whole population in memory, then bulk-write in 50k-row batches).
 *
 * Determinism: every random draw flows from the seeded PRNG; the start date is
 * supplied here so the timeline is reproducible. Run against the dedicated sim
 * DB only (`dotenv -e .env.sim`).
 */

interface ParsedArgs {
  seed: number;
  start: string;
  days: number;
  reranker: "identity";
  personaLimit?: number;
  concurrency: number;
  mode: SimMode;
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
  const concurrency = Number(get("concurrency") ?? 8);
  const modeArg = get("mode") ?? "batched";
  if (modeArg !== "batched" && modeArg !== "service")
    throw new Error(`--mode must be 'batched' or 'service' (got '${modeArg}')`);
  const mode = modeArg satisfies SimMode;

  if (rerankerArg !== "identity") {
    throw new Error(
      `Only --reranker=identity is wired today (got '${rerankerArg}'). A Phase-2+ re-ranker drops into the same seam.`,
    );
  }
  const reranker = "identity" as const;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start))
    throw new Error(`--start must be YYYY-MM-DD (got '${start}')`);

  return { seed, start, days, reranker, personaLimit, concurrency, mode };
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
    const gtPath = await writeGroundTruthFile(
      groundTruthPath(args.seed, args.days),
      {
        meta: {
          seed: args.seed,
          start: args.start,
          days: args.days,
          mode: args.mode,
          personas: result.groundTruth.length,
          kind: "phase-2-ground-truth",
        },
        personas: result.groundTruth,
      },
    );
    logger.log(`Ground-truth sidecar written: ${gtPath}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
