import type { PrismaService } from "../../prisma/prisma.service";
import {
  blendBias,
  correctDuration,
  maxBias,
  type TagBias,
} from "../../scheduler/duration-bias";
import { aggregateTagBias, type BiasEvent } from "./tag-bias";

/**
 * Phase-2 OFFLINE duration backtest (phase-2-evaluation-steps §Step 4). The
 * cheap pre-filter gate for the duration corrector, computed on the FROZEN
 * Phase-1 (identity) `TaskEvent` log already in the DB — no re-simulation.
 *
 * The gate (heuristic §Offline evaluation / §Phase 2): recompute the
 * bias-corrected duration for every historical task and ship the corrector only
 * if the corrected-vs-true error drops below the estimate-vs-true error.
 *
 * Gate statistic — MEAN error reduction (not median). The median is uninformative
 * here: durations live on the 15-minute grid, so for the bulk of tasks the
 * |true − est| residual is already pinned at the grid floor (0 or 15 min) and the
 * median sits there for BOTH est and corrected regardless of how much the
 * corrector helps the heavy-tailed under/over-estimators. The doc backtest showed
 * mean|true − est| = 31.4 → blend 23.2 (−26%) while the median barely moved. So
 * the DECIDING gate is now:
 *
 *     mean|true − corrected| < mean|true − est|     (passesBlend / passesMax)
 *
 * with a trimmed mean (10% each tail, robust to a few pathological tasks) and a
 * fraction-of-tasks-improved measure reported alongside; the median is KEPT for
 * reference only and no longer decides pass/fail.
 *
 * "true" is the persona's actual duration (the last RESIZE's `durationMinutes`);
 * "est" is the typed estimate (the CREATE `durationMinutes`); "corrected" is what
 * the Phase-2 corrector WOULD have produced — `correctDuration(est, bias)` where
 * `bias` blends the per-tag table the corrector estimates from this same log.
 *
 * Anti-leakage note: the per-tag bias is aggregated from the persona's OWN log
 * exactly as `eval/recovery.ts` and the live corrector do, never from the hidden
 * `tagBias` sidecar — so this scores what a learner could actually compute.
 *
 * The scoring MATH ({@link durationBacktest}) is pure + unit-tested
 * (`duration-backtest.spec.ts`); `scoreDurationBacktest` is the I/O wrapper that
 * reads the log, groups it per user, and pools the per-task errors.
 */

/** One task's create estimate + observed true duration + its tags. */
export interface BacktestTask {
  estimated: number;
  trueDuration: number;
  tags: string[];
  /** The per-tag bias table the corrector learned for THIS task's persona. */
  perTag: Map<string, TagBias>;
}

export interface DurationBacktestResult {
  tasks: number;
  /** MEAN |true − est| over the scored tasks (the incumbent error — gate basis). */
  meanEstError: number;
  /** MEAN |true − corrected| under the sample-weighted blend (the default). */
  meanCorrectedErrorBlend: number;
  /** MEAN |true − corrected| under Conservative Max-Bias (the §8 ablation). */
  meanCorrectedErrorMax: number;
  /** 10%-trimmed mean |true − est| (robust to a few pathological tasks). */
  trimmedMeanEstError: number;
  /** 10%-trimmed mean |true − corrected| under the blend. */
  trimmedMeanCorrectedErrorBlend: number;
  /** 10%-trimmed mean |true − corrected| under max-bias. */
  trimmedMeanCorrectedErrorMax: number;
  /** Fraction of tasks the blend correction strictly moved CLOSER to true. */
  fractionImprovedBlend: number;
  /** Fraction of tasks max-bias correction strictly moved closer to true. */
  fractionImprovedMax: number;
  /** Relative mean-error reduction under blend: (estErr − corrErr) / estErr. */
  meanReductionBlend: number;
  /** Relative mean-error reduction under max-bias. */
  meanReductionMax: number;
  /** median |true − est| over the scored tasks — REPORTED FOR REFERENCE ONLY. */
  medianEstError: number;
  /** median |true − corrected| under the blend — REFERENCE ONLY (not the gate). */
  medianCorrectedErrorBlend: number;
  /** median |true − corrected| under max-bias — REFERENCE ONLY (not the gate). */
  medianCorrectedErrorMax: number;
  /** Gate: MEAN blend error strictly below the MEAN estimate error. */
  passesBlend: boolean;
  /** Gate under max-bias (for the §8 inflation comparison), MEAN-based. */
  passesMax: boolean;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Symmetric trimmed mean: drop `frac` of the mass off EACH tail (default 10%),
 * then average the middle. Falls back to the plain mean when the sample is too
 * small to trim a whole element off both ends. Robust to the heavy right tail of
 * duration residuals (a handful of badly-estimated tasks).
 */
function trimmedMean(xs: number[], frac = 0.1): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * frac);
  const mid = s.slice(k, s.length - k);
  return mid.length ? mean(mid) : mean(s);
}

/**
 * Pure backtest over a set of scored tasks. Each task carries its OWN persona's
 * per-tag bias table (so a multi-persona pool is scored with each persona's
 * learned correction). For each task, blend (or max) its tags' biases, correct
 * the estimate, and compare both errors against the true duration.
 */
export function durationBacktest(
  tasks: BacktestTask[],
): DurationBacktestResult {
  const estErr: number[] = [];
  const corrErrBlend: number[] = [];
  const corrErrMax: number[] = [];
  let improvedBlend = 0;
  let improvedMax = 0;

  for (const t of tasks) {
    const bias = t.tags
      .map((tag) => t.perTag.get(tag))
      .filter((b): b is TagBias => b !== undefined);
    const blended = correctDuration(t.estimated, blendBias(bias));
    const maxed = correctDuration(t.estimated, maxBias(bias));
    const eErr = Math.abs(t.trueDuration - t.estimated);
    const bErr = Math.abs(t.trueDuration - blended);
    const mErr = Math.abs(t.trueDuration - maxed);
    estErr.push(eErr);
    corrErrBlend.push(bErr);
    corrErrMax.push(mErr);
    if (bErr < eErr) improvedBlend++;
    if (mErr < eErr) improvedMax++;
  }

  const meanEstError = mean(estErr);
  const meanCorrectedErrorBlend = mean(corrErrBlend);
  const meanCorrectedErrorMax = mean(corrErrMax);
  const n = tasks.length;
  return {
    tasks: n,
    meanEstError,
    meanCorrectedErrorBlend,
    meanCorrectedErrorMax,
    trimmedMeanEstError: trimmedMean(estErr),
    trimmedMeanCorrectedErrorBlend: trimmedMean(corrErrBlend),
    trimmedMeanCorrectedErrorMax: trimmedMean(corrErrMax),
    fractionImprovedBlend: n ? improvedBlend / n : 0,
    fractionImprovedMax: n ? improvedMax / n : 0,
    meanReductionBlend:
      meanEstError > 0
        ? (meanEstError - meanCorrectedErrorBlend) / meanEstError
        : 0,
    meanReductionMax:
      meanEstError > 0
        ? (meanEstError - meanCorrectedErrorMax) / meanEstError
        : 0,
    medianEstError: median(estErr),
    medianCorrectedErrorBlend: median(corrErrBlend),
    medianCorrectedErrorMax: median(corrErrMax),
    // DECIDING gate is the MEAN error (median is grid-floor-pinned, see header).
    passesBlend: meanCorrectedErrorBlend < meanEstError,
    passesMax: meanCorrectedErrorMax < meanEstError,
  };
}

/**
 * Build the scored task set (each tagged with its persona's learned per-tag bias)
 * from the frozen log, then run the pure backtest. Only tasks with a CREATE
 * estimate AND an observed RESIZE (true) duration are scored — a task accepted
 * unchanged carries no independent "true" signal to measure correction against.
 */
export async function scoreDurationBacktest(
  prisma: PrismaService,
): Promise<DurationBacktestResult> {
  const events = await prisma.taskEvent.findMany({
    where: { eventType: { in: ["CREATE", "RESIZE", "KEEP", "COMPLETE"] } },
    orderBy: { occurredAt: "asc" },
    select: {
      userId: true,
      eventType: true,
      taskId: true,
      newSnapshot: true,
    },
  });

  // Group per user so each persona's corrector reads only its OWN evidence.
  const byUser = new Map<string, BiasEvent[]>();
  for (const e of events) {
    const list = byUser.get(e.userId) ?? [];
    list.push({
      eventType: e.eventType,
      taskId: e.taskId,
      newSnapshot: e.newSnapshot as BiasEvent["newSnapshot"],
    });
    byUser.set(e.userId, list);
  }

  const tasks: BacktestTask[] = [];
  for (const [, userEvents] of byUser) {
    const perTag = aggregateTagBias(userEvents);
    for (const t of scoredTasksFromEvents(userEvents)) {
      tasks.push({ ...t, perTag });
    }
  }

  return durationBacktest(tasks);
}

/** Extract scored (est, true, tags) tasks from one persona's event stream. */
function scoredTasksFromEvents(
  events: BiasEvent[],
): Omit<BacktestTask, "perTag">[] {
  interface Obs {
    estimated: number | null;
    actual: number | null;
    tags: string[];
  }
  const byTask = new Map<string, Obs>();
  const obs = (id: string): Obs => {
    let o = byTask.get(id);
    if (!o) {
      o = { estimated: null, actual: null, tags: [] };
      byTask.set(id, o);
    }
    return o;
  };
  for (const e of events) {
    const snap = e.newSnapshot;
    if (!snap) continue;
    const o = obs(e.taskId);
    if (snap.tags && snap.tags.length) o.tags = snap.tags;
    if (e.eventType === "CREATE")
      o.estimated = snap.durationMinutes ?? o.estimated;
    else if (e.eventType === "RESIZE")
      o.actual = snap.durationMinutes ?? o.actual;
  }
  const out: Omit<BacktestTask, "perTag">[] = [];
  for (const o of byTask.values()) {
    if (o.estimated && o.estimated > 0 && o.actual && o.actual > 0) {
      out.push({
        estimated: o.estimated,
        trueDuration: o.actual,
        tags: o.tags,
      });
    }
  }
  return out;
}
