import type { SessionType } from "./task";

/**
 * Visual states a task card can render in (see design-system.md).
 *
 * All but "conflict" are a pure function of the session `type`: a flexible
 * TASK is "fluid", and each fixed type carries its own colour so an
 * assignment, an exam, a lecture and a DND block are all distinguishable at a
 * glance rather than sharing one "fixed" slate. "conflict" is layered on top
 * client-side from time-overlap detection (`packages/core/src/task-card.ts`'s
 * `withOverlap`) — there is no backend conflict flag. There is no "overdue"
 * state: a past-deadline session just renders in its type colour.
 */
export type SessionCardState =
  | "fluid"
  | "conflict"
  | "assignment"
  | "exam"
  | "lecture"
  | "dnd";

/**
 * A positioned calendar block — one concrete, scheduled session.
 * `id` and `taskId` both address that real, mutable session.
 */
export interface Event {
  id: string;
  /** The persisted session row this block edits/moves; equals {@link id}. */
  taskId: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  type: SessionType;
  tags: string[];
  state: SessionCardState;
}

/**
 * A calendar block clamped to a single day column. A session whose scheduled
 * interval crosses midnight is rendered as two segments sharing the same
 * {@link Event.taskId}: the portion before midnight (`continues: true`) and the
 * leftover portion on the next day (`continued: true`). `start`/`end` here are
 * clamped to the segment's own day so positioning stays inside the 0–1440
 * grid; the original (unclamped) instants live in `taskStart`/`taskEnd`.
 */
export interface DaySegment extends Event {
  /** Unique per-segment key for dnd-kit + overlap layout (the task id plus a suffix). */
  segmentId: string;
  /** True when the session continues past this day's midnight (head segment). */
  continues?: boolean;
  /** True when this segment is the leftover spilling in from the previous day (tail). */
  continued?: boolean;
  /** The session's true (unclamped) start instant — what mutations reschedule against. */
  taskStart: string;
  /** The session's true (unclamped) end instant. */
  taskEnd: string;
}
