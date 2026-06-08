// types.ts or schema.ts
import * as z from "zod";
import { DAILY_HORIZON, TIME_GRANULARITY } from "./constants";
import { deleteData, getData, postData } from "@/api";
import { Task } from "@/types/tasks";
import { extractFileIdsFromNoteContent } from "./files";

export const taskSchema = z.object({
  title: z.string().min(1, { error: "Task name is required" }),
  duration: z
    .int()
    .min(TIME_GRANULARITY, {
      error: `Task duration must be at least ${TIME_GRANULARITY} minutes`,
    })
    .max(DAILY_HORIZON, { error: "Task duration must be at most 24 hours" }),
  tags: z.array(z.string()).default([]),
  deadlineDate: z
    .string()
    .refine(
      (val) => {
        if (!val) return true;
        if (isNaN(Date.parse(val))) return false;
        return true;
      },
      { message: "Invalid date format" },
    )
    .optional(),
  isFixed: z.boolean().default(false),
  fixedStart: z
    .number()
    .min(0)
    .max(DAILY_HORIZON - TIME_GRANULARITY)
    .default(0),
  fixedEnd: z
    .number()
    .min(TIME_GRANULARITY)
    .max(DAILY_HORIZON)
    .default(DAILY_HORIZON),
  deadlineTime: z.string().optional(),
  note: z.string().optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;
export type EditTaskFormValues = TaskFormValues;

export async function deleteTask(taskId: string) {
  const { data } = await getData<{ data: { task: Task } }>(`/tasks/${taskId}`);
  const previousIds = extractFileIdsFromNoteContent(data.task.note || "");
  if (previousIds.length > 0) {
    await postData("/files/remove", { ids: previousIds });
  }
  return deleteData(`/tasks/${taskId}`);
}
