import type { Task } from "@zenflow/shared";
import type { Event } from "@/types/schedule";
import { deriveState } from "@/lib/task-card";

/** Convert a scheduled task into a positioned calendar block (null if unplaced). */
export function taskToBlock(task: Task): Event | null {
  if (!task.scheduledStartTime) return null;
  const start = new Date(task.scheduledStartTime);
  const end = new Date(start.getTime() + task.durationMinutes * 60_000);
  return {
    id: task.id,
    taskId: task.id,
    title: task.title,
    start: start.toISOString(),
    end: end.toISOString(),
    status: task.status,
    fixed: task.fixed,
    conflict: task.conflict,
    tags: task.tags,
    state: deriveState(task),
  };
}

export function tasksToBlocks(tasks: Task[]): Event[] {
  return tasks
    .map((t) => taskToBlock(t))
    .filter((b): b is Event => b !== null);
}
