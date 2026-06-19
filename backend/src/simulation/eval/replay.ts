import type { PrismaService } from "../../prisma/prisma.service";
import type { SlotReRanker } from "../../scheduler/reranker";
import { identityReRanker } from "../../scheduler/reranker";
import type { EdfTask } from "../../scheduler/edf";

/**
 * Offline counterfactual replay scaffold (strategy §13 Step 1, the cheap gate
 * BEFORE a closed-loop A/B). Re-scores each logged decision under a candidate
 * `SlotReRanker` and estimates its expected reward off-policy with IPS / SNIPS
 * (Inverse-Propensity-Scoring / Self-Normalized IPS).
 *
 * This is a SCAFFOLD: it defines the estimator and the data path over the
 * `TaskEvent` log. A real candidate re-ranker (Phase 2+) plugs into the
 * `candidate` argument; until one exists, replaying the identity re-ranker
 * against itself gives the baseline propensity sanity-check (ratio ≈ 1).
 *
 * Why off-policy: the logged reactions were produced under the INCUMBENT policy.
 * A new re-ranker would have changed the suggestions and thus the reactions, so
 * the log can only conservatively *pre-filter* a candidate — the honest proof is
 * a closed-loop re-simulation (Step 2), two `sim:run`s with the same `--seed`.
 */

interface LoggedDecision {
  taskId: string;
  userId: string;
  /** The slot the engine suggested (CREATE/MOVE oldSnapshot suggestedStartTime). */
  suggested: Date | null;
  /** The slot the user ended at (newSnapshot scheduledStartTime). */
  chosen: Date | null;
  /** Reward realised for this decision (from the event rewardScore). */
  reward: number;
  /** The feasible candidate set re-derivable from the snapshot context. */
  context: ReplayContext;
}

export interface ReplayContext {
  task: Pick<EdfTask, "durationMinutes" | "deadline">;
  tags: string[];
  /** Candidate slots the incumbent enumerated (only suggested+chosen known from log). */
  candidates: Date[];
}

export interface ReplayEstimate {
  /** Inverse-Propensity-Scoring reward estimate. */
  ips: number;
  /** Self-Normalized IPS (lower variance; strategy §16.3 Swaminathan & Joachims). */
  snips: number;
  decisions: number;
}

/**
 * Estimate a candidate re-ranker's reward from the logged decisions.
 *
 * For each decision we form the importance weight `w = π_candidate(chosen | x) /
 * π_incumbent(chosen | x)`. The incumbent (identity / Phase-1) is deterministic
 * earliest-fit, so its propensity for the chosen slot is modelled as a softened
 * indicator (a small floor avoids division by zero). The candidate's propensity
 * is the softmax mass it would assign the chosen slot. IPS = mean(w·r); SNIPS =
 * Σ(w·r) / Σw.
 */
export function estimateReplay(
  decisions: LoggedDecision[],
  candidate: SlotReRanker,
  incumbent: SlotReRanker = identityReRanker,
): ReplayEstimate {
  let ipsSum = 0;
  let wSum = 0;
  let wrSum = 0;
  let n = 0;

  for (const d of decisions) {
    if (!d.chosen || d.context.candidates.length === 0) continue;
    const task = {
      id: d.taskId,
      durationMinutes: d.context.task.durationMinutes,
      deadline: d.context.task.deadline,
      fixed: false,
      manuallyMoved: false,
      schedulingAnchor: null,
      scheduledStartTime: null,
      createdAt: new Date(0),
      conflict: false,
    } as EdfTask;

    const pCand = propensity(candidate, task, d.context.candidates, d.chosen);
    const pIncum = Math.max(
      0.05,
      propensity(incumbent, task, d.context.candidates, d.chosen),
    );
    const w = pCand / pIncum;
    ipsSum += w * d.reward;
    wSum += w;
    wrSum += w * d.reward;
    n++;
  }

  return {
    ips: n > 0 ? ipsSum / n : 0,
    snips: wSum > 0 ? wrSum / wSum : 0,
    decisions: n,
  };
}

/**
 * Softmax-style propensity a re-ranker assigns to `chosen`: it ranks the
 * candidates and converts rank position to a probability (rank 0 = most mass).
 * A deterministic re-ranker thus concentrates mass on its top choice; the floor
 * keeps the estimator well-defined.
 */
function propensity(
  reranker: SlotReRanker,
  task: EdfTask,
  candidates: Date[],
  chosen: Date,
): number {
  const ordered = reranker.score(task, candidates);
  const idx = ordered.findIndex((c) => c.getTime() === chosen.getTime());
  if (idx < 0) return 0.05;
  // Geometric decay over rank: top choice ~0.5, then halving.
  const masses = ordered.map((_, i) => Math.pow(0.5, i + 1));
  const total = masses.reduce((a, b) => a + b, 0) || 1;
  return masses[idx] / total;
}

/**
 * Build the replay decision set from the logged `TaskEvent`s. The candidate set
 * a decision was made over is not fully stored, so we reconstruct the minimal
 * pair (suggested, chosen) the log DOES carry — enough for the propensity
 * sanity-check. A richer reconstruction (re-running `feasibleSlots` per decision)
 * is left as the Phase-2/3 follow-up when a real candidate re-ranker exists.
 */
export async function loadDecisions(
  prisma: PrismaService,
): Promise<LoggedDecision[]> {
  const events = await prisma.taskEvent.findMany({
    where: { eventType: { in: ["MOVE", "RESIZE", "KEEP"] } },
    orderBy: { occurredAt: "asc" },
    select: {
      taskId: true,
      userId: true,
      oldSnapshot: true,
      newSnapshot: true,
      rewardScore: true,
    },
  });

  const out: LoggedDecision[] = [];
  for (const e of events) {
    const oldS = e.oldSnapshot as { suggestedStartTime?: string | null } | null;
    const newS = e.newSnapshot as {
      scheduledStartTime?: string | null;
      tags?: string[];
      durationMinutes?: number;
      suggestedStartTime?: string | null;
    } | null;
    if (!newS) continue;
    const suggestedIso =
      newS.suggestedStartTime ?? oldS?.suggestedStartTime ?? null;
    const chosenIso = newS.scheduledStartTime ?? null;
    const suggested = suggestedIso ? new Date(suggestedIso) : null;
    const chosen = chosenIso ? new Date(chosenIso) : null;
    const candidates = [suggested, chosen].filter((d): d is Date => d !== null);
    out.push({
      taskId: e.taskId,
      userId: e.userId,
      suggested,
      chosen,
      reward: e.rewardScore,
      context: {
        task: { durationMinutes: newS.durationMinutes ?? 15, deadline: null },
        tags: newS.tags ?? [],
        candidates,
      },
    });
  }
  return out;
}
