import type { DaySegment, Event } from "@zenflow/shared";

/** The layout key for a block — a per-segment id when split, else the task id. */
const keyOf = (ev: Event | DaySegment): string =>
  (ev as DaySegment).segmentId ?? ev.id;

/** Layout assignment for a single calendar block. */
export interface BlockLayout {
  /** 0-based column within its overlap cluster. */
  column: number;
  /** Total number of columns the cluster spans. */
  columns: number;
  /** True when the block shares time with at least one other block. */
  conflict: boolean;
}

/**
 * Resolve side-by-side placement for overlapping blocks.
 *
 * Blocks that overlap in time are grouped into a "cluster" and packed into the
 * fewest columns possible (greedy interval colouring). Each block then renders
 * at `column / columns` width, so overlapping tasks sit next to each other
 * instead of stacking on top of (and visually swallowing) one another.
 *
 * A completed task no longer occupies its slot — the user already did it — so it
 * never raises a conflict and is never flagged itself: a live task scheduled on
 * top of a finished one is not a clash. A block is flagged as a conflict only
 * when it genuinely overlaps in time another LIVE (non-DONE) block in its
 * cluster, using the strict half-open rule `aStart < bEnd && bStart < aEnd`.
 * Blocks that merely touch at a boundary (`aEnd === bStart`) are placed into a
 * fresh cluster and always render at full width. Completed blocks still take a
 * column so they keep rendering side-by-side.
 *
 * The input array is treated as read-only — it is cloned before sorting.
 */
export function getOverlapLayout(
  events: Array<Event | DaySegment>,
): Map<string, BlockLayout> {
  const layout = new Map<string, BlockLayout>();
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      new Date(a.end).getTime() - new Date(b.end).getTime(),
  );

  let cluster: Array<Event | DaySegment> = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedily pack the cluster into columns; a column is free once its last
    // block ends at or before the candidate's start.
    const colEnds: number[] = [];
    const colOf = new Map<string, number>();
    for (const ev of cluster) {
      const start = new Date(ev.start).getTime();
      let col = colEnds.findIndex((end) => end <= start);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = new Date(ev.end).getTime();
      colOf.set(keyOf(ev), col);
    }
    const columns = colEnds.length;
    // A block conflicts only when it is live AND genuinely overlaps (strict
    // half-open) some OTHER live block in the cluster. Touching boundaries
    // (aEnd === bStart) do not clash; live-on-DONE is never a clash.
    const live = cluster.filter((ev) => ev.status !== "DONE");
    for (const ev of cluster) {
      const conflict =
        ev.status !== "DONE" &&
        live.some((other) => {
          if (keyOf(other) === keyOf(ev)) return false;
          const aStart = new Date(ev.start).getTime();
          const aEnd = new Date(ev.end).getTime();
          const bStart = new Date(other.start).getTime();
          const bEnd = new Date(other.end).getTime();
          return aStart < bEnd && bStart < aEnd;
        });
      layout.set(keyOf(ev), {
        column: colOf.get(keyOf(ev)) ?? 0,
        columns,
        conflict,
      });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of sorted) {
    const start = new Date(ev.start).getTime();
    // A new cluster starts whenever the next event begins at or after the
    // running cluster end — i.e. both a gap and a touching boundary (start ===
    // clusterEnd) close the current cluster. Touching events do NOT share a
    // column group: Session C starting exactly when Session B ends should render at
    // full width, not inherit the multi-column layout of the A-B overlap group.
    if (cluster.length > 0 && start >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, new Date(ev.end).getTime());
  }
  flush();

  return layout;
}
