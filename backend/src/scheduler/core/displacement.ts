import {
  ceilToSlot,
  MS_PER_MINUTE,
  overlapsAny,
  SLOT_MS,
  type Interval,
} from "./slot";
import { bestFreeSlot, slotPreferenceScore } from "./slot-score";
import { DISPLACEMENT_CANDIDATES, MAX_DISPLACED_TASKS } from "../constants";

/**
 * Displacement of flexible tasks (issue #62 B) — pure, no I/O, no clock, no
 * randomness (CLAUDE.md invariant 2). When a new/edited `TASK` has no free
 * slot before its deadline, {@link planDisplacement} repacks the flexible
 * (standalone, engine-placed) tasks inside a window in earliest-deadline-first
 * order, moving as few as possible and never touching `fixed` blocks. Wider
 * windows are only tried when the narrower one is infeasible. When even that
 * fails, {@link pickMinConflictSlot} / {@link pickLateSlot} implement the two
 * user-chosen fallbacks.
 */

export interface FlexibleTask {
  id: string;
  durationMinutes: number;
  deadlineMs: number;
  /** Current start. */
  startMs: number;
}

export interface DisplacementMove {
  id: string;
  fromMs: number;
  toMs: number;
}

export type DisplacementPlan =
  | { kind: "placed"; startMs: number; moves: DisplacementMove[] }
  | { kind: "infeasible" };

export interface DisplacementInput {
  task: { durationMinutes: number; deadlineMs: number };
  /** Every scheduled standalone TASK the caller loaded (the planner picks those in each window). */
  flexible: FlexibleTask[];
  /** Fixed blocks (DND/ASSIGNMENT/EXAM/LECTURE, series sittings, ...) — never moved. */
  fixed: Interval[];
  nowMs: number;
  /** Progressively wider windows: tried in order, first feasible wins. */
  windows: { startMs: number; endMs: number }[];
  prefMatrix: number[];
  timezone: string;
  maxMoves?: number;
  candidates?: number;
}

const endOf = (t: { startMs: number; durationMinutes: number }) =>
  t.startMs + t.durationMinutes * MS_PER_MINUTE;

/** Simulates the EDF cascade for one candidate start of the new task. */
function cascade(
  candidate: Interval,
  obstacles: Interval[],
  participants: FlexibleTask[],
  win: { startMs: number; endMs: number },
  lowerMs: number,
  input: DisplacementInput,
  maxMoves: number,
): DisplacementMove[] | null {
  const occupied: Interval[] = [...obstacles, candidate];
  const moves: DisplacementMove[] = [];
  // EDF: earliest deadline first, id as the deterministic tie-break.
  const ordered = [...participants].sort(
    (a, b) => a.deadlineMs - b.deadlineMs || (a.id < b.id ? -1 : 1),
  );
  for (const p of ordered) {
    const pEnd = endOf(p);
    if (!overlapsAny(occupied, p.startMs, pEnd)) {
      occupied.push({ start: p.startMs, end: pEnd }); // min-displacement: stay put
      continue;
    }
    const ceiling = Math.min(p.deadlineMs, win.endMs);
    const slot = bestFreeSlot(
      p.durationMinutes,
      occupied,
      new Date(Math.max(lowerMs, win.startMs)),
      new Date(ceiling),
      input.prefMatrix,
      input.timezone,
      new Date(ceiling),
      p.startMs,
    );
    if (!slot) return null;
    moves.push({ id: p.id, fromMs: p.startMs, toMs: slot.getTime() });
    if (moves.length > maxMoves) return null;
    occupied.push({
      start: slot.getTime(),
      end: slot.getTime() + p.durationMinutes * MS_PER_MINUTE,
    });
  }
  return moves;
}

/**
 * Finds a start for the new task plus the (capped, minimal) set of flexible
 * moves that make room, or `infeasible`. Deterministic.
 */
export function planDisplacement(input: DisplacementInput): DisplacementPlan {
  const { task, flexible, fixed, nowMs, prefMatrix, timezone } = input;
  const maxMoves = input.maxMoves ?? MAX_DISPLACED_TASKS;
  const K = input.candidates ?? DISPLACEMENT_CANDIDATES;
  const durationMs = task.durationMinutes * MS_PER_MINUTE;
  const durationHours = durationMs / (60 * MS_PER_MINUTE);
  const lowerMs = ceilToSlot(nowMs);

  for (const win of input.windows) {
    // Only not-yet-started flexible tasks touching the window may move.
    const participants = flexible.filter(
      (f) =>
        endOf(f) > win.startMs && f.startMs < win.endMs && f.startMs >= lowerMs,
    );
    const pIds = new Set(participants.map((p) => p.id));
    const obstacles: Interval[] = [
      ...fixed,
      ...flexible
        .filter((f) => !pIds.has(f.id))
        .map((f) => ({ start: f.startMs, end: endOf(f) })),
    ];

    // Candidate starts for the new task: free of obstacles (participants are
    // movable), inside the window, ending by the deadline; best scored first.
    const scored: { startMs: number; score: number }[] = [];
    for (
      let s = Math.max(lowerMs, ceilToSlot(win.startMs));
      s < win.endMs && s + durationMs <= task.deadlineMs;
      s += SLOT_MS
    ) {
      if (overlapsAny(obstacles, s, s + durationMs)) continue;
      scored.push({
        startMs: s,
        score:
          slotPreferenceScore(prefMatrix, s, s + durationMs, timezone) /
          durationHours,
      });
    }
    scored.sort((a, b) => b.score - a.score || a.startMs - b.startMs);

    let best: {
      startMs: number;
      score: number;
      moves: DisplacementMove[];
    } | null = null;
    for (const cand of scored.slice(0, K)) {
      const moves = cascade(
        { start: cand.startMs, end: cand.startMs + durationMs },
        obstacles,
        participants,
        win,
        lowerMs,
        input,
        maxMoves,
      );
      if (!moves) continue;
      if (
        best === null ||
        moves.length < best.moves.length ||
        (moves.length === best.moves.length && cand.score > best.score)
      ) {
        best = { ...cand, moves };
      }
    }
    if (best) {
      return { kind: "placed", startMs: best.startMs, moves: best.moves };
    }
  }
  return { kind: "infeasible" };
}

export interface FallbackSlotInput {
  durationMinutes: number;
  nowMs: number;
  deadlineMs: number;
  /** Everything on the calendar (fixed + flexible). */
  occupied: Interval[];
  prefMatrix: number[];
  timezone: string;
  /** Last instant a late slot may END (bounded scan). */
  horizonEndMs?: number;
}

/**
 * "Accept conflicts": the start before the deadline overlapping the least
 * calendar time (ties: better preference, then earlier). `null` only when not
 * even one slot fits before the deadline.
 */
export function pickMinConflictSlot(input: FallbackSlotInput): number | null {
  const { durationMinutes, nowMs, deadlineMs, occupied, prefMatrix, timezone } =
    input;
  const durationMs = durationMinutes * MS_PER_MINUTE;
  let best: { startMs: number; overlap: number; score: number } | null = null;
  for (let s = ceilToSlot(nowMs); s + durationMs <= deadlineMs; s += SLOT_MS) {
    let overlap = 0;
    for (const o of occupied) {
      overlap += Math.max(
        0,
        Math.min(o.end, s + durationMs) - Math.max(o.start, s),
      );
    }
    const score = slotPreferenceScore(prefMatrix, s, s + durationMs, timezone);
    if (
      best === null ||
      overlap < best.overlap ||
      (overlap === best.overlap && score > best.score)
    ) {
      best = { startMs: s, overlap, score };
    }
  }
  return best?.startMs ?? null;
}

/**
 * "Accept late deadline": the earliest conflict-free start at/after now whose
 * END passes the deadline. `null` if none within `horizonEndMs`.
 */
export function pickLateSlot(input: FallbackSlotInput): number | null {
  const { durationMinutes, nowMs, deadlineMs, occupied } = input;
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const horizon =
    input.horizonEndMs ?? deadlineMs + 30 * 24 * 60 * MS_PER_MINUTE;
  for (let s = ceilToSlot(nowMs); s + durationMs <= horizon; s += SLOT_MS) {
    if (s + durationMs <= deadlineMs) continue; // on-time slots are the caller's job
    if (!overlapsAny(occupied, s, s + durationMs)) return s;
  }
  return null;
}
