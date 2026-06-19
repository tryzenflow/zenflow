import { DaySegment, Event } from "@/types/schedule";

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
 * top of a finished one is not a clash. A block is therefore flagged as a
 * conflict only when its cluster holds two or more LIVE (non-DONE) blocks.
 * Completed blocks still take a column so they keep rendering side-by-side.
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
    const liveMembers = cluster.filter((ev) => ev.status !== "DONE").length;
    for (const ev of cluster) {
      layout.set(keyOf(ev), {
        column: colOf.get(keyOf(ev)) ?? 0,
        columns,
        conflict: ev.status !== "DONE" && liveMembers > 1,
      });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of sorted) {
    const start = new Date(ev.start).getTime();
    // A gap (start at/after the running cluster end) closes the current cluster.
    if (cluster.length > 0 && start >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, new Date(ev.end).getTime());
  }
  flush();

  return layout;
}
