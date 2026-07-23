import * as z from "zod";
import { DAILY_HORIZON, SLOT_MINUTES, type Task } from "@zenflow/shared";
import { zonedDate } from "./tz";

/**
 * Task validation schema — the single source of truth for the create/edit
 * task form contract, shared by `frontend/` and `mobile/` so the two clients
 * can never drift apart on what a valid task looks like (CLAUDE.md §1: the
 * shared package is the contract).
 *
 * Ported verbatim from `frontend/src/utils/tasks.ts` (RN migration Phase 5,
 * GitHub issue #20) — logic unchanged, only the import paths for the
 * duration-granularity constants moved from `frontend`'s local
 * `utils/constants.ts` duplicate to the canonical `@zenflow/shared` copy
 * (`SLOT_MINUTES`/`DAILY_HORIZON`), which both already re-export the same
 * values (`frontend/src/utils/constants.ts`'s `TIME_GRANULARITY` === 15 ===
 * `SLOT_MINUTES`).
 *
 * NOTE: `frontend/src/utils/tasks.ts` still defines its own local copy of
 * this schema rather than importing this one — the mobile RN migration task
 * that hoisted this file (#20) was scoped to `mobile/` + `packages/core/`
 * only and explicitly did not touch `frontend/`. That leaves a real (if
 * momentary) fork: this file and `frontend/src/utils/tasks.ts`'s `taskSchema`
 * must be kept in sync by hand until a follow-up repoints `frontend/` at this
 * export too. See the mobile RN migration doc / issue #20 for the full
 * rationale.
 */
export const MAX_TITLE_LENGTH = 60;

export const taskSchema = z.object({
  title: z
    .string()
    .min(1, { error: "Task name is required" })
    .max(MAX_TITLE_LENGTH, {
      error: `Title must be at most ${MAX_TITLE_LENGTH} characters.`,
    }),
  duration: z
    .int()
    .min(SLOT_MINUTES, {
      error: `Task duration must be at least ${SLOT_MINUTES} minutes`,
    })
    .max(DAILY_HORIZON, { error: "Task duration must be at most 24 hours" }),
  tags: z.array(z.string()).default([]),
  /**
   * Single resolved ISO-8601 instant, set by the deadline quick-action chip
   * row — required, since the view-scoped scheduling model (and its optional
   * deadline) is gone.
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

/**
 * Client-side signal for why a task's placement is unusual — the backend
 * doesn't return *why* a concrete placement was chosen, so callers derive
 * this themselves to annotate a success/conflict toast after create/update.
 * `null` when the task has no placement at all (a last-resort `conflict`) —
 * nothing meaningful to qualify.
 *
 * Pure port of `frontend/src/utils/tasks.ts`'s `placementQualifier` — no
 * logic changes, just hoisted alongside the schema since it's pure (only
 * needs the shared `Task` type + `zonedDate`, no DOM/app-specific imports).
 */
export type PlacementQualifier = "onTime" | "outsideHours" | "pastDeadline";

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
