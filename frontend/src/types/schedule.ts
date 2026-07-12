import type { TaskCardState, TaskStatus } from "@zenflow/shared";

export type { ViewMode } from "@zenflow/shared";

/**
 * A positioned calendar block — one concrete, scheduled task.
 * `id` and `taskId` both address that real, mutable task. Built via
 * {@link taskToBlock}.
 */
export interface Event {
  id: string;
  /** The persisted task row this block edits/moves; equals {@link id}. */
  taskId: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  status: TaskStatus;
  /** True when the task is pinned (manually dragged/resized, or an accepted overflow choice). */
  manuallyMoved: boolean;
  conflict: boolean;
  tags: string[];
  state: TaskCardState;
}

/**
 * A calendar block clamped to a single day column. A task whose scheduled
 * interval crosses midnight is rendered as two segments sharing the same
 * {@link Event.taskId}: the portion before midnight (`continues: true`) and the
 * leftover portion on the next day (`continued: true`). `start`/`end` here are
 * clamped to the segment's own day so positioning stays inside the 0–1440
 * grid; the original (unclamped) instants live in `taskStart`/`taskEnd`.
 */
export interface DaySegment extends Event {
  /** Unique per-segment key for dnd-kit + overlap layout (the task id plus a suffix). */
  segmentId: string;
  /** True when the task continues past this day's midnight (head segment). */
  continues?: boolean;
  /** True when this segment is the leftover spilling in from the previous day (tail). */
  continued?: boolean;
  /** The task's true (unclamped) start instant — what mutations reschedule against. */
  taskStart: string;
  /** The task's true (unclamped) end instant. */
  taskEnd: string;
}
