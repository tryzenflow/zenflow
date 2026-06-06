import type { TaskCardState, TaskStatus } from "@zenflow/shared";

export type { ViewMode } from "@zenflow/shared";

/**
 * A positioned calendar block — one concrete, scheduled occurrence of a task.
 * Recurring tasks expand into multiple blocks (each with a synthetic `id` but a
 * shared `taskId`). Built from a Task via {@link taskToBlock}.
 */
export interface Event {
  id: string;
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
