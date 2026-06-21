import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import type { PrismaService } from "../../prisma/prisma.service";
import type { SlotReRanker } from "../../scheduler/reranker";
import {
  identityReRanker,
  preferenceMatrixReRanker,
} from "../../scheduler/reranker";
import type { EdfTask, SchedulerPrefs } from "../../scheduler/edf";
import { feasibleSlots } from "../../scheduler/edf";
import { localDateStr } from "../../scheduler/slot";
import { minutesToUtc } from "../../common/utils";
import { applyPreferenceDeltas } from "../../scheduler/telemetry";

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
  /**
   * The feasible candidate set for this decision, reconstructed by re-running the
   * pure `feasibleSlots` over the logged task context (see
   * {@link reconstructCandidates}) — the real set the off-policy estimator ranks,
   * not just the suggested+chosen pair.
   */
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
 * Reconstruct the REAL feasible candidate set a decision was made over by
 * re-running the pure scheduler core's {@link feasibleSlots} for the logged task
 * context — the Phase-2 follow-up the old docstring flagged. The log stores only
 * (suggested, chosen), which gives the off-policy estimator ≤2 candidates per
 * decision and so cannot discriminate two re-rankers (both rank a 2-element set
 * almost identically). Enumerating the genuine feasible set restores the
 * discrimination.
 *
 * Pure + deterministic: enumerated from `prefs`, the task `durationMinutes` /
 * `deadline`, and a `now` floor derived from the decision instants — no I/O, no
 * randomness, no `Date.now()`. We pin `now` to the START OF DAY (user tz) of the
 * earliest of {suggested, chosen} and pass it as both `now` and `earliest`, so
 * the enumeration spans that working day forward and necessarily contains both
 * the suggested and chosen slots (both lie at/after the day start). `occupied` is
 * left empty: the frozen log does not carry the full board at decision time, so
 * we reconstruct the unconstrained working-window candidate set (a superset that
 * always contains the two slots the decision actually ranged over). As a
 * belt-and-braces guard the suggested + chosen slots are unioned in and the set
 * is de-duplicated + sorted, so a slot off the enumerated grid (an out-of-hours
 * override) is never dropped.
 */
export function reconstructCandidates(
  prefs: SchedulerPrefs,
  durationMinutes: number,
  deadline: Date | null,
  suggested: Date | null,
  chosen: Date | null,
): Date[] {
  const anchors = [suggested, chosen].filter((d): d is Date => d !== null);
  const byTime = new Map<number, Date>();
  if (anchors.length > 0) {
    const earliest = anchors.reduce((a, b) => (a <= b ? a : b));
    const dayStart = minutesToUtc(
      localDateStr(earliest, prefs.timezone),
      0,
      prefs.timezone,
    );
    for (const c of feasibleSlots(
      prefs,
      durationMinutes,
      deadline,
      [],
      dayStart,
      dayStart,
    )) {
      byTime.set(c.getTime(), c);
    }
  }
  // Union the two logged slots in case either fell outside the enumerated grid.
  for (const d of anchors) byTime.set(d.getTime(), d);
  return [...byTime.values()].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Build the replay decision set from the logged `TaskEvent`s, reconstructing the
 * real feasible candidate set per decision via {@link reconstructCandidates}
 * (re-running the pure `feasibleSlots` over the logged task context + the user's
 * scheduler prefs). This gives the placement IPS/SNIPS the genuine candidate set
 * to discriminate re-rankers, rather than the ≤2-element (suggested, chosen) pair.
 */
export async function loadDecisions(
  prisma: PrismaService,
): Promise<LoggedDecision[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      workStart: true,
      workEnd: true,
      workDays: true,
      timezone: true,
    },
  });
  const prefsById = new Map<string, SchedulerPrefs>(
    users.map((u) => [
      u.id,
      {
        workStart: u.workStart,
        workEnd: u.workEnd,
        workDays: u.workDays,
        timezone: u.timezone,
      },
    ]),
  );

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
    const oldS = e.oldSnapshot as {
      suggestedStartTime?: string | null;
      deadline?: string | null;
    } | null;
    const newS = e.newSnapshot as {
      scheduledStartTime?: string | null;
      tags?: string[];
      durationMinutes?: number;
      suggestedStartTime?: string | null;
      deadline?: string | null;
    } | null;
    if (!newS) continue;
    const suggestedIso =
      newS.suggestedStartTime ?? oldS?.suggestedStartTime ?? null;
    const chosenIso = newS.scheduledStartTime ?? null;
    const suggested = suggestedIso ? new Date(suggestedIso) : null;
    const chosen = chosenIso ? new Date(chosenIso) : null;
    const deadlineIso = newS.deadline ?? oldS?.deadline ?? null;
    const deadline = deadlineIso ? new Date(deadlineIso) : null;
    const durationMinutes = newS.durationMinutes ?? 15;

    const prefs = prefsById.get(e.userId);
    const candidates = prefs
      ? reconstructCandidates(
          prefs,
          durationMinutes,
          deadline,
          suggested,
          chosen,
        )
      : [suggested, chosen].filter((d): d is Date => d !== null);

    out.push({
      taskId: e.taskId,
      userId: e.userId,
      suggested,
      chosen,
      reward: e.rewardScore,
      context: {
        task: { durationMinutes, deadline },
        tags: newS.tags ?? [],
        candidates,
      },
    });
  }
  return out;
}

// ──────────────────────────── Phase-2 replay candidate ──────────────────────

/**
 * Reconstruct each user's signed 672-cell preference matrix from the SAME
 * telemetry the production `SchedulerService` writes (the move-toward `+1` /
 * move-away `−1` deltas on MOVE, the `+1` on a completed-in-slot KEEP), using the
 * shared pure {@link applyPreferenceDeltas}. This is the matrix the Phase-2
 * re-ranker reads. Returns the matrix + the user's timezone (needed for the grid
 * index). Cold-start users (no deltas) get an all-zero matrix → identity.
 */
export async function reconstructUserMatrices(
  prisma: PrismaService,
): Promise<Map<string, { matrix: number[]; timezone: string }>> {
  const users = await prisma.user.findMany({
    select: { id: true, timezone: true },
  });
  const tzById = new Map(users.map((u) => [u.id, u.timezone]));

  const events = await prisma.taskEvent.findMany({
    where: { eventType: { in: ["MOVE", "KEEP"] } },
    orderBy: { occurredAt: "asc" },
    select: {
      userId: true,
      eventType: true,
      oldSnapshot: true,
      newSnapshot: true,
    },
  });

  const out = new Map<string, { matrix: number[]; timezone: string }>();
  for (const e of events) {
    const tz = tzById.get(e.userId);
    if (!tz) continue;
    const newS = e.newSnapshot as { scheduledStartTime?: string | null } | null;
    const oldS = e.oldSnapshot as { scheduledStartTime?: string | null } | null;
    const chosen = newS?.scheduledStartTime
      ? new Date(newS.scheduledStartTime)
      : null;
    if (!chosen) continue;

    const deltas: { at: Date; delta: number }[] = [{ at: chosen, delta: +1 }];
    if (e.eventType === "MOVE") {
      const vacated = oldS?.scheduledStartTime
        ? new Date(oldS.scheduledStartTime)
        : null;
      if (vacated && vacated.getTime() !== chosen.getTime())
        deltas.push({ at: vacated, delta: -1 });
    }
    const prev =
      out.get(e.userId)?.matrix ??
      new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(0);
    out.set(e.userId, {
      matrix: applyPreferenceDeltas(prev, deltas, tz),
      timezone: tz,
    });
  }
  return out;
}

/**
 * The Phase-2 placement candidate for offline replay (eval Step 4 / ADR-0001 §5):
 * a single {@link SlotReRanker} that dispatches each scored decision to the
 * RIGHT user's {@link preferenceMatrixReRanker} (keyed by the task id → user it
 * sees in the decision context). Built over the reconstructed per-user matrices
 * so `estimateReplay(decisions, phase2Candidate)` estimates the Phase-2 policy's
 * off-policy reward against the frozen Phase-1 log.
 *
 * `estimateReplay` calls `score(task, candidates)` without a userId, so the
 * candidate routes by `task.id` (which equals the decision's `taskId`) via the
 * supplied `userOf` map; an unknown task falls back to identity.
 */
export function phase2ReplayCandidate(
  matrices: Map<string, { matrix: number[]; timezone: string }>,
  userOf: Map<string, string>,
): SlotReRanker {
  return {
    score(task: EdfTask, candidates: Date[]): Date[] {
      const userId = userOf.get(task.id);
      const entry = userId ? matrices.get(userId) : undefined;
      if (!entry) return identityReRanker.score(task, candidates);
      return preferenceMatrixReRanker(entry.matrix, entry.timezone).score(
        task,
        candidates,
      );
    },
  };
}

/** Map each decision's `taskId` → `userId`, so the candidate can route per user. */
export function decisionUserMap(
  decisions: LoggedDecision[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of decisions) out.set(d.taskId, d.userId);
  return out;
}

/**
 * Convenience: run the offline replay of the Phase-2 candidate against the
 * identity incumbent, over the frozen log. Returns both estimates so the caller
 * can report the Phase-2 lift (Step-4 gate: Phase-2 SNIPS must clear identity).
 */
export async function replayPhase2(prisma: PrismaService): Promise<{
  identity: ReplayEstimate;
  phase2: ReplayEstimate;
}> {
  const decisions = await loadDecisions(prisma);
  const matrices = await reconstructUserMatrices(prisma);
  const userOf = decisionUserMap(decisions);
  const candidate = phase2ReplayCandidate(matrices, userOf);
  return {
    identity: estimateReplay(decisions, identityReRanker, identityReRanker),
    phase2: estimateReplay(decisions, candidate, identityReRanker),
  };
}
