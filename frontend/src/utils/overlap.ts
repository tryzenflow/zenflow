import { Event } from "@/types/schedule";

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
 * instead of stacking on top of (and visually swallowing) one another. Any
 * block in a multi-member cluster is flagged as a manual conflict.
 *
 * The input array is treated as read-only — it is cloned before sorting.
 */
export function getOverlapLayout(events: Event[]): Map<string, BlockLayout> {
  const layout = new Map<string, BlockLayout>();
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      new Date(a.end).getTime() - new Date(b.end).getTime(),
  );

  let cluster: Event[] = [];
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
      colOf.set(ev.id, col);
    }
    const columns = colEnds.length;
    const conflict = cluster.length > 1;
    for (const ev of cluster) {
      layout.set(ev.id, { column: colOf.get(ev.id) ?? 0, columns, conflict });
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
