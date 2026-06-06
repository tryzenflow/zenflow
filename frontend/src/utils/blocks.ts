import type { Task } from "@zenflow/shared";
import type { Event } from "@/types/schedule";
import { deriveState } from "@/lib/task-card";

/** Convert a scheduled task into a positioned calendar block (null if unplaced). */
export function taskToBlock(task: Task): Event | null {
  if (!task.scheduledStartTime) return null;
  const start = new Date(task.scheduledStartTime);
  const end = new Date(start.getTime() + task.durationMinutes * 60_000);
  return {
    // Each occurrence is its own row now (materialized series), so both the
    // block id and the mutation target are the real task id; seriesId is only
    // a grouping link between siblings, never a mutation target.
    id: task.id,
    taskId: task.id,
    title: task.title,
    start: start.toISOString(),
    end: end.toISOString(),
    status: task.status,
    fixed: task.fixed,
    conflict: task.conflict,
    tags: task.tags,
    rrule: task.rrule,
    state: deriveState(task),
  };
}

export function tasksToBlocks(tasks: Task[]): Event[] {
  return tasks
    .map((t) => taskToBlock(t))
    .filter((b): b is Event => b !== null);
}
