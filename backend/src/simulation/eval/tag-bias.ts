import type { TagBias } from "../../scheduler/duration-bias";

/**
 * Aggregate a per-tag duration-bias table (`{ n, b }` = sample count + rolling
 * `actual ÷ estimated` multiplier) from a stream of task-event snapshots.
 *
 * This is the SERVICE-side aggregation the Phase-2 corrector consumes (ADR-0001
 * §2): the pure {@link blendBias} blender lives in `scheduler/duration-bias.ts`;
 * this estimates the table that feeds it. The simulator's batched engine uses it
 * to drive the live Phase-2 corrector from a persona's OWN accumulating
 * telemetry, and the recovery eval (`eval/recovery.ts`) uses the SAME estimator
 * so `b̂_tag` is scored exactly as the corrector would compute it.
 *
 * Signal model (mirrors `docs/heuristic.md` §Phase 2 "actual ÷ estimated"):
 *  - A CREATE establishes a task's ESTIMATED duration + its tag names.
 *  - A RESIZE reveals the user's correction toward the ACTUAL duration; the last
 *    RESIZE for a task is its observed actual.
 *  - A task completed/kept WITHOUT a resize is an accepted estimate → ratio 1.0.
 *  Each task contributes ONE observation (its final ratio) to every tag it
 *  carried, so a multi-tag task informs all of its tags equally.
 */

/** The minimal event shape the aggregator reads (a `SimEvent`/`TaskEvent` row). */
export interface BiasEvent {
  eventType: string;
  taskId: string;
  newSnapshot: {
    durationMinutes?: number;
    tags?: string[];
  } | null;
}

interface TaskObs {
  estimated: number | null;
  actual: number | null;
  tags: string[];
  settled: boolean; // completed/kept without a resize → accepted estimate
}

/**
 * Roll up the per-tag `{ n, b }` evidence table from an event stream. Pure: it
 * only reads the snapshots handed in. Tags with no usable observation are absent
 * from the result.
 */
export function aggregateTagBias(events: BiasEvent[]): Map<string, TagBias> {
  const byTask = new Map<string, TaskObs>();
  const obs = (id: string): TaskObs => {
    let o = byTask.get(id);
    if (!o) {
      o = { estimated: null, actual: null, tags: [], settled: false };
      byTask.set(id, o);
    }
    return o;
  };

  for (const e of events) {
    const snap = e.newSnapshot;
    if (!snap) continue;
    const o = obs(e.taskId);
    if (snap.tags && snap.tags.length) o.tags = snap.tags;
    if (e.eventType === "CREATE") {
      o.estimated = snap.durationMinutes ?? o.estimated;
    } else if (e.eventType === "RESIZE") {
      o.actual = snap.durationMinutes ?? o.actual;
    } else if (e.eventType === "KEEP" || e.eventType === "COMPLETE") {
      o.settled = true;
    }
  }

  // sum/count per tag → mean ratio.
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  for (const o of byTask.values()) {
    if (!o.estimated || o.estimated <= 0 || o.tags.length === 0) continue;
    let ratio: number | null = null;
    if (o.actual && o.actual > 0) ratio = o.actual / o.estimated;
    else if (o.settled) ratio = 1.0; // accepted estimate
    if (ratio === null) continue;
    for (const tag of o.tags) {
      sum.set(tag, (sum.get(tag) ?? 0) + ratio);
      count.set(tag, (count.get(tag) ?? 0) + 1);
    }
  }

  const out = new Map<string, TagBias>();
  for (const [tag, n] of count) {
    out.set(tag, { n, b: (sum.get(tag) ?? 0) / n });
  }
  return out;
}
