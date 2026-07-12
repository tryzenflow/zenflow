// types.ts or schema.ts
import * as z from "zod";
import { DAILY_HORIZON, TIME_GRANULARITY } from "./constants";
import { getData, postData } from "@/api";
import { Task } from "@/types/tasks";
import type { Event as CalendarBlock } from "@/types/schedule";
import { extractFileIdsFromNoteContent } from "./files";
import { removeTask } from "@/api/tasks";
import { zonedDate, zonedWallClockToUtc } from "./tz";

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
export async function deleteTask(taskId: string) {
  const { data } = await getData<{ data: { task: Task } }>(`/tasks/${taskId}`);
  const previousIds = extractFileIdsFromNoteContent(data.task.note || "");
  if (previousIds.length > 0) {
    await postData("/files/remove", { ids: previousIds });
  }
  return removeTask(taskId);
}

/**
 * Whether a deadline/tags edit or a delete should prompt for a
 * confirm-before-reschedule at all. A task with no placement has no window
 * to reschedule around; a task already past or in progress (`start <= now`)
 * is edited/deleted outright — todo.md §Rescheduling Design says a
 * past/in-progress change never prompts.
 */
export function needsRescheduleWindow(
  scheduledStartTime: string | null,
  now: Date,
): boolean {
  return scheduledStartTime !== null && new Date(scheduledStartTime) > now;
}

/**
 * The shared confirm-before-reschedule window (todo.md §Rescheduling
 * Design) for every trigger that can leave a schedule gap/conflict behind —
 * a deadline edit, a tags-driven duration change, or a delete. Normally ±3
 * workdays around the affected task's own placement (`scheduledStartTime`,
 * captured BEFORE the edit/delete since the edit doesn't reposition the task
 * and a delete removes it). The back side is clamped to `now`: any of the 3
 * preceding workdays whose start has already passed is dropped, and the
 * forward side gains one workday for each one dropped, so the total window
 * always spans 6 workdays around the anchor day (plus the anchor day
 * itself). Only call this when {@link needsRescheduleWindow} is true.
 */
export function cascadeWindow(
  scheduledStartTime: string,
  tz: string,
  user: { workStart: number; workEnd: number; workDays: number[] },
  now: Date,
): { windowStart: string; windowEnd: string } {
  const isWorkDay = (d: Date) => {
    const iso = d.getDay() === 0 ? 7 : d.getDay();
    return user.workDays.includes(iso);
  };
  const workDaysFrom = (from: Date, dir: 1 | -1, count: number): Date[] => {
    const days: Date[] = [];
    let cur = from;
    // Bounded scan: a `workDays` misconfigured to empty would otherwise spin
    // forever looking for a workday that doesn't exist.
    for (let i = 0; days.length < count && i < 365; i++) {
      cur = new Date(cur);
      cur.setDate(cur.getDate() + dir);
      if (isWorkDay(cur)) days.push(cur);
    }
    return days;
  };
  /** Exclusive end of the working day starting at local midnight `dayStart`. */
  const dayEnd = (dayStart: Date): Date => {
    const end = new Date(dayStart);
    end.setDate(end.getDate() + (user.workEnd <= user.workStart ? 2 : 1));
    return end;
  };

  const anchorDay = zonedDate(scheduledStartTime, tz);
  anchorDay.setHours(0, 0, 0, 0);

  const backCandidates = workDaysFrom(anchorDay, -1, 3); // nearest→farthest
  const survivingBack = backCandidates.filter(
    (d) => zonedWallClockToUtc(d, tz) >= now,
  );
  const clamped = backCandidates.length - survivingBack.length;
  const forwardDays = workDaysFrom(anchorDay, 1, 3 + clamped);

  const earliestDay =
    survivingBack.length > 0 ? survivingBack[survivingBack.length - 1] : anchorDay;
  const latestDay = forwardDays[forwardDays.length - 1];

  const rawStart = zonedWallClockToUtc(earliestDay, tz);
  const windowStart = rawStart < now ? now : rawStart;
  const windowEnd = zonedWallClockToUtc(dayEnd(latestDay), tz);

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

/**
 * Whether any currently-loaded calendar block is a manually-moved task
 * (`manuallyMoved: true`) whose scheduled start falls inside
 * `[windowStart, windowEnd)` (both ISO-8601 instants). Used to decide
 * whether a deadline/tags-change reschedule needs the 3-option
 * manual-vs-auto choice (todo.md §Rescheduling Design) instead of the plain
 * 2-button confirm — when nothing manual is in scope, "only auto" and
 * "everyone" are behaviorally identical.
 */
export function hasManualTaskInWindow(
  blocks: CalendarBlock[],
  windowStart: string,
  windowEnd: string,
): boolean {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  return blocks.some((b) => {
    if (!b.manuallyMoved) return false;
    const blockStart = new Date(b.start).getTime();
    return blockStart >= start && blockStart < end;
  });
}
