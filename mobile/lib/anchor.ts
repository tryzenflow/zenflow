import { zonedDate } from "@zenflow/core";
import type { Session, SessionAnchor, SessionType } from "@zenflow/shared";
import { format } from "date-fns";

/** Types the scheduler never moves (ADR-0022): they are always fixed. */
const FIXED_TYPES: ReadonlySet<SessionType> = new Set([
  "DND",
  "ASSIGNMENT",
  "EXAM",
  "LECTURE",
]);

/** The mark a block wears: a hand for a time the user chose, a lock for a pin. */
export type AnchorMark = "hand" | "lock" | null;

export function anchorMark(anchor: SessionAnchor | undefined): AnchorMark {
  if (anchor === "CHOSEN") return "hand";
  if (anchor === "PINNED") return "lock";
  return null;
}

/** A block the scheduler will not move: fixed, pinned, or already completed. */
export function isImmovable(block: {
  type: SessionType;
  anchor?: SessionAnchor;
  completedAt?: string | null;
}): boolean {
  return (
    FIXED_TYPES.has(block.type) ||
    block.anchor === "PINNED" ||
    !!block.completedAt
  );
}

/** A block on one day, as minutes from midnight. */
export interface PlanBlock {
  id: string;
  startMin: number;
  durationMin: number;
  immovable: boolean;
}

/** A movable block the drop would push, shown as a ghost at its new start. */
export interface GhostShift {
  id: string;
  fromMin: number;
  toMin: number;
  durationMin: number;
}

export type DropPreview =
  | { blocked: true; by: string; ghosts: [] }
  | { blocked: false; ghosts: GhostShift[] };

/**
 * What a drop of `dragged` at `startMin` would do to the day. A drop that
 * overlaps an immovable block, or that pushes a block past the end of the day
 * or into one, is blocked (the card bounces back). Otherwise each movable
 * block the drop runs into is pushed to the end of the block before it, in
 * start order. This previews the shift; the scheduler still decides the plan.
 */
export function dropPreview(
  dragged: { id: string; durationMin: number },
  startMin: number,
  others: PlanBlock[],
  dayEndMin = 24 * 60,
): DropPreview {
  const dropEnd = startMin + dragged.durationMin;
  const rest = others.filter((b) => b.id !== dragged.id);

  const immovableHit = (start: number, end: number) =>
    rest.find(
      (b) =>
        b.immovable && b.startMin < end && start < b.startMin + b.durationMin,
    );

  const direct = immovableHit(startMin, dropEnd);
  if (direct) return { blocked: true, by: direct.id, ghosts: [] };

  const movable = rest
    .filter((b) => !b.immovable && b.startMin + b.durationMin > startMin)
    .sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));

  const ghosts: GhostShift[] = [];
  let cursor = dropEnd;
  for (const block of movable) {
    if (block.startMin >= cursor) break;
    const toEnd = cursor + block.durationMin;
    if (toEnd > dayEndMin) return { blocked: true, by: block.id, ghosts: [] };
    const hit = immovableHit(cursor, toEnd);
    if (hit) return { blocked: true, by: hit.id, ghosts: [] };
    ghosts.push({
      id: block.id,
      fromMin: block.startMin,
      toMin: cursor,
      durationMin: block.durationMin,
    });
    cursor = toEnd;
  }
  return { blocked: false, ghosts };
}

/** The user-tz calendar day of an instant, as `yyyy-MM-dd`. */
export function dayKeyOf(iso: string, tz: string): string {
  return format(zonedDate(iso, tz), "yyyy-MM-dd");
}

/** Minutes from midnight of an instant, on the user's wall clock. */
export function minutesOfDay(iso: string, tz: string): number {
  const d = zonedDate(iso, tz);
  return d.getHours() * 60 + d.getMinutes();
}

/** The timed sessions on one user-tz day, as blocks for {@link dropPreview}. */
export function blocksOnDay(
  sessions: Session[],
  dayKey: string,
  tz: string,
): PlanBlock[] {
  return sessions.flatMap((s) =>
    s.scheduledStartTime && dayKeyOf(s.scheduledStartTime, tz) === dayKey
      ? [
          {
            id: s.id,
            startMin: minutesOfDay(s.scheduledStartTime, tz),
            durationMin: s.durationMinutes,
            immovable: isImmovable(s),
          },
        ]
      : [],
  );
}

/**
 * The drop of `dragged` at `startISO` against the sessions on its day. A
 * blocked drop bounces back; an unblocked one lists the ghosts it would shift.
 */
export function dropOnDay(
  dragged: Session,
  startISO: string,
  sessions: Session[],
  tz: string,
): DropPreview {
  return dropPreview(
    { id: dragged.id, durationMin: dragged.durationMinutes },
    minutesOfDay(startISO, tz),
    blocksOnDay(sessions, dayKeyOf(startISO, tz), tz),
  );
}
