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
  /**
   * True when this block is short enough to be fully time-contained within
   * another block in its cluster (its range sits inside the container's,
   * either edge may touch, and it is strictly shorter). Rather than
   * splitting the two into half-width side-by-side columns — unreadable for
   * a 15-minute task — the nested block renders at (near) full width, inset
   * down-and-right so it visibly peeks out from behind its container.
   */
  nested?: boolean;
  /**
   * 0-based index among sibling blocks nested under the same container, used
   * to stagger the inset offset so several stacked blocks don't fully
   * overlap each other.
   */
  nestIndex?: number;
}

/**
 * Resolve side-by-side placement for overlapping blocks.
 *
 * Blocks that overlap in time are grouped into a "cluster" and packed into the
 * fewest columns possible (greedy interval colouring). Each block then renders
 * at `column / columns` width, so overlapping tasks sit next to each other
 * instead of stacking on top of (and visually swallowing) one another.
 *
 * A DND block is protected time, not a scheduled commitment — so it never
 * raises a conflict and is never flagged itself: a live session scheduled on
 * top of a DND block is not a clash. A block is flagged as a conflict only
 * when it genuinely overlaps in time another non-DND block in its cluster,
 * using the strict half-open rule `aStart < bEnd && bStart < aEnd`. Blocks
 * that merely touch at a boundary (`aEnd === bStart`) are placed into a fresh
 * cluster and always render at full width. DND blocks still take a column so
 * they keep rendering side-by-side.
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

  // True when `inner`'s time range sits entirely inside `outer`'s (either
  // edge may touch) and `inner` is strictly shorter — i.e. `inner` is fully
  // swallowed by `outer`'s time range. Dropping a dragged block so it starts
  // exactly on a 15-minute boundary shared with its container (a very common
  // outcome of drag-snapping) must still count as contained, so both edges
  // use an inclusive bound; only the strict duration comparison keeps two
  // identical-range blocks (or the block being compared to itself) from
  // "containing" each other.
  const isContained = (
    outer: Event | DaySegment,
    inner: Event | DaySegment,
  ) => {
    const outerStart = new Date(outer.start).getTime();
    const outerEnd = new Date(outer.end).getTime();
    const innerStart = new Date(inner.start).getTime();
    const innerEnd = new Date(inner.end).getTime();
    const outerDuration = outerEnd - outerStart;
    const innerDuration = innerEnd - innerStart;
    return (
      innerStart >= outerStart &&
      innerEnd <= outerEnd &&
      innerDuration < outerDuration
    );
  };

  const flush = () => {
    if (cluster.length === 0) return;

    // A fully time-contained short block (e.g. a 15-minute task dropped
    // inside a longer session) is rendered stacked on top of its container
    // instead of splitting both into unreadably-narrow side-by-side columns.
    // Pick the tightest containing block when several qualify, so a block
    // nests under its most immediate container.
    const containerKeyOf = new Map<string, string>();
    for (const ev of cluster) {
      let best: Event | DaySegment | null = null;
      let bestDuration = Infinity;
      for (const other of cluster) {
        if (other === ev || !isContained(other, ev)) continue;
        const duration =
          new Date(other.end).getTime() - new Date(other.start).getTime();
        if (duration < bestDuration) {
          best = other;
          bestDuration = duration;
        }
      }
      if (best) containerKeyOf.set(keyOf(ev), keyOf(best));
    }

    // Greedily pack the non-nested blocks into columns; a column is free once
    // its last block ends at or before the candidate's start. Nested blocks
    // are excluded here — they inherit their container's column/width below.
    const primary = cluster.filter((ev) => !containerKeyOf.has(keyOf(ev)));
    const colEnds: number[] = [];
    const colOf = new Map<string, number>();
    for (const ev of primary) {
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
    // A block conflicts only when it is non-DND AND genuinely overlaps (strict
    // half-open) some OTHER non-DND block in the cluster. Touching boundaries
    // (aEnd === bStart) do not clash; overlapping a DND block is never a clash.
    const live = cluster.filter((ev) => ev.type !== "DND");
    const nestIndexOf = new Map<string, number>();
    for (const ev of cluster) {
      const conflict =
        ev.type !== "DND" &&
        live.some((other) => {
          if (keyOf(other) === keyOf(ev)) return false;
          const aStart = new Date(ev.start).getTime();
          const aEnd = new Date(ev.end).getTime();
          const bStart = new Date(other.start).getTime();
          const bEnd = new Date(other.end).getTime();
          return aStart < bEnd && bStart < aEnd;
        });
      const containerKey = containerKeyOf.get(keyOf(ev));
      if (containerKey) {
        const nestIndex = nestIndexOf.get(containerKey) ?? 0;
        nestIndexOf.set(containerKey, nestIndex + 1);
        layout.set(keyOf(ev), {
          column: colOf.get(containerKey) ?? 0,
          columns,
          conflict,
          nested: true,
          nestIndex,
        });
      } else {
        layout.set(keyOf(ev), {
          column: colOf.get(keyOf(ev)) ?? 0,
          columns,
          conflict,
        });
      }
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
