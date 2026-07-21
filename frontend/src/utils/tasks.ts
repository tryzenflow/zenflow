// types.ts or schema.ts
import * as z from "zod";
import { DAILY_HORIZON, TIME_GRANULARITY } from "./constants";
import { getData, postData } from "@/api";
import { Task } from "@/types/tasks";
import { extractFileIdsFromNoteContent } from "./files";
import { removeTask } from "@/api/tasks";
import type { RemoveTaskResponse } from "@zenflow/shared";
import { zonedDate } from "./tz";

/**
 * Client-side signal for why a task's placement is unusual — the backend no
 * longer returns *why* a concrete placement was chosen (the `overflow`
 * envelope is gone; every create/update now always resolves to a concrete
 * slot), so callers derive this themselves to annotate the success toast.
 * `null` when the task has no placement at all (still a last-resort
 * `conflict`) — nothing meaningful to qualify.
 */
export type PlacementQualifier = "onTime" | "outsideHours" | "pastDeadline";

/**
 * Compares a task's `scheduledStartTime` against its deadline and the user's
 * work window (checked in the user's tz, same wall-clock rule as the rest of
 * the calendar — see `utils/tz.ts`). `pastDeadline` is checked first since
 * it's the more informative signal when both are true (e.g. an overdue task
 * placed at 2am is more useful described as "past its deadline").
 */
export function placementQualifier(
  task: Task,
  user: { workStart: number; workEnd: number; workDays: number[]; timezone: string },
): PlacementQualifier | null {
  if (!task.scheduledStartTime) return null;

  const start = new Date(task.scheduledStartTime);
  if (task.deadline && start > new Date(task.deadline)) return "pastDeadline";

  const zoned = zonedDate(task.scheduledStartTime, user.timezone);
  const minutesOfDay = zoned.getHours() * 60 + zoned.getMinutes();
  const isoWeekday = zoned.getDay() === 0 ? 7 : zoned.getDay();

  if (!user.workDays.includes(isoWeekday)) return "outsideHours";

  // Overnight windows (workEnd <= workStart) wrap past midnight, so "inside
  // hours" is the union of [workStart, 1440) and [0, workEnd) instead of a
  // single contiguous range.
  const inWindow =
    user.workEnd <= user.workStart
      ? minutesOfDay >= user.workStart || minutesOfDay < user.workEnd
      : minutesOfDay >= user.workStart && minutesOfDay < user.workEnd;

  return inWindow ? "onTime" : "outsideHours";
}

export const taskSchema = z.object({
  title: z.string().min(1, { error: "Task name is required" }),
  duration: z
    .int()
    .min(TIME_GRANULARITY, {
      error: `Task duration must be at least ${TIME_GRANULARITY} minutes`,
    })
    .max(DAILY_HORIZON, { error: "Task duration must be at most 24 hours" }),
  tags: z.array(z.string()).default([]),
  /**
   * Single resolved ISO-8601 instant, set by the deadline quick-action chip
   * row (`DeadlineChipField`) — required, since the view-scoped scheduling
   * model (and its optional deadline) is gone.
   */
  deadline: z
    .string()
    .min(1, { error: "Pick a deadline" })
    .refine((val) => !isNaN(Date.parse(val)), {
      error: "Invalid date format",
    }),
  note: z.string().optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;
export type EditTaskFormValues = TaskFormValues;

/** Delete a task, cleaning up any note attachments it referenced. */
export async function deleteTask(
  taskId: string,
): Promise<RemoveTaskResponse> {
  const { data } = await getData<{ data: { task: Task } }>(`/tasks/${taskId}`);
  const previousIds = extractFileIdsFromNoteContent(data.task.note || "");
  if (previousIds.length > 0) {
    await postData("/files/remove", { ids: previousIds });
  }
  return removeTask(taskId);
}

