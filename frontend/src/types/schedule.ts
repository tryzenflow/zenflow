import type { TaskCardState, TaskStatus } from "@zenflow/shared";

export type { ViewMode } from "@zenflow/shared";

/**
 * A positioned calendar block — one concrete, scheduled occurrence of a task.
 * Each occurrence (recurring or not) is its own persisted row, so `id` and
 * `taskId` both address that real, mutable task. Built via {@link taskToBlock}.
 */
export interface Event {
  id: string;
  /** The persisted task row this block edits/moves; equals {@link id}. */
  taskId: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  status: TaskStatus;
  fixed: boolean;
  conflict: boolean;
  tags: string[];
  rrule: string;
  state: TaskCardState;
}
