// types.ts or schema.ts
import * as z from "zod";
import { DAILY_HORIZON } from "../types/prefs";

export const taskSchema = z
  .object({
    title: z.string().min(1, { error: "Task name is required" }),

    scheduleDate: z.date({ error: "A date is required." }),
    duration: z
      .int()
      .min(5, { error: "Task duration must be at least 5 minutes" })
      .max(DAILY_HORIZON, { error: "Task duration must be at most 24 hours" }),
    priority: z
      .int()
      .min(1, { error: "Task priority must be at least 1" })
      .max(3, { error: "Task priority must be at most 3" }),
    focus: z
      .int()
      .min(1, { error: "Task focus must be at least 1" })
      .max(3, { error: "Task focus must be at most 3" }),
    categoryId: z.string().optional(),
    earliestStart: z
      .int()
      .min(0, { error: "Task earliest start must be from 12AM" })
      .max(DAILY_HORIZON, {
        error: "Task earliest start must be at most 11:59PM",
      })
      .optional(),
    latestEnd: z
      .int()
      .min(0, { error: "Task latest end must be from 12AM" })
      .max(DAILY_HORIZON, { error: "Task latest end must be at most 11:59PM" })
      .optional(),
    deadlineDate: z.date().optional(),
    deadlineTime: z.string().optional(),
    note: z.string().optional(),
    maxSplits: z.number().min(1).max(10).default(1),
    prerequisites: z.array(z.string()).optional(),
  })
  .refine(
    (arg) =>
      (arg?.latestEnd || DAILY_HORIZON) >=
      (arg?.earliestStart || 0) + arg.duration,
    {
      error: "Earliest start + duration > latest end",
      path: ["earliestStart"],
    }
  );

export type TaskFormValues = z.infer<typeof taskSchema>;
