// types.ts or schema.ts
import * as z from "zod";
import { DAILY_HORIZON } from "../types/prefs";
import { deleteData, getData, postData } from "../api";
import { Task } from "../types/tasks";
import { extractFileIdsFromNoteContent } from "./files";
import { rrulestr, RRule, Weekday } from "rrule";

export const taskSchema = z
  .object({
    title: z.string().min(1, { error: "Task name is required" }),

    scheduleDate: z.date({ error: "A date is required." }),
    duration: z
      .int()
      .min(5, { error: "Task duration must be at least 5 minutes" })
      .max(DAILY_HORIZON, { error: "Task duration must be at most 24 hours" }),
    mandatory: z.boolean(),
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
    isRecurring: z.boolean().default(false),
    deadlineTime: z.string().optional(),
    note: z.string().optional(),
    maxSplits: z.number().min(1).max(10).default(1),
    prerequisites: z.array(z.string()).optional(),
    frequency: z.enum(["YEARLY", "MONTHLY", "WEEKLY", "DAILY"]),
    interval: z.number().min(1),
    byweekday: z.array(z.string()),
    bymonthday: z.number().min(1).max(31),
    bysetpos: z.number(),
    byweekdayMonth: z.string(),
    monthlyMode: z.enum(["on", "on_the"]),
    yearlyMode: z.enum(["on", "on_the"]),
    month: z.number().min(1).max(12),
    endMode: z.enum(["never", "after", "on"]),
    count: z.number().min(1),
    until: z.date().optional(),
  })
  .refine(
    (arg) =>
      (arg?.latestEnd || DAILY_HORIZON) >=
      (arg?.earliestStart || 0) + arg.duration,
    {
      error: "Earliest start + duration > latest end",
      path: ["earliestStart"],
    },
  );

export type TaskFormValues = z.infer<typeof taskSchema>;

export async function deleteTask(taskId: string) {
  const data = await getData<{ data: Task }>(`/tasks/${taskId}`);
  const previousIds = extractFileIdsFromNoteContent(data.data.note || "");
  if (previousIds.length > 0) {
    await postData("/files/remove", { ids: previousIds });
  }
  return deleteData(`/tasks/${taskId}`);
}

export const generateRRule = (values: z.infer<typeof taskSchema>) => {
  // Format DTSTART as RFC 5545: YYYYMMDDTHHMMSSZ (no milliseconds, no punctuation)
  const dtstart =
    values.scheduleDate.toISOString().split(".")[0].replace(/[-:]/g, "") + "Z";
  let rrule = `DTSTART:${dtstart}\n`;
  rrule += `RRULE:FREQ=${values.frequency}`;

  rrule += `;INTERVAL=${values.interval}`;

  if (values.frequency === "WEEKLY" && values.byweekday.length > 0) {
    rrule += `;BYDAY=${values.byweekday.join(",")}`;
  }

  if (values.frequency === "MONTHLY") {
    if (values.monthlyMode === "on") {
      rrule += `;BYMONTHDAY=${values.bymonthday}`;
    } else {
      rrule += `;BYDAY=${values.byweekdayMonth};BYSETPOS=${values.bysetpos}`;
    }
  }

  if (values.frequency === "YEARLY") {
    rrule += `;BYMONTH=${values.month}`;
    if (values.yearlyMode === "on") {
      rrule += `;BYMONTHDAY=${values.bymonthday}`;
    } else {
      rrule += `;BYDAY=${values.byweekdayMonth};BYSETPOS=${values.bysetpos}`;
    }
  }

  if (values.endMode === "after") {
    rrule += `;COUNT=${values.count}`;
  } else if (values.endMode === "on" && values.until) {
    // Format UNTIL as YYYYMMDDTHHMMSSZ (no milliseconds, no punctuation)
    const untilStr =
      values.until.toISOString().split(".")[0].replace(/[-:]/g, "") + "Z";
    rrule += `;UNTIL=${untilStr}`;
  }

  return rrule;
};

export const parseRRule = (rruleString: string): Partial<TaskFormValues> => {
  try {
    // Parse the RRULE string
    const rule = rrulestr(rruleString);
    const options = rule.origOptions;

    // Extract DTSTART
    const scheduleDate = options.dtstart
      ? new Date(options.dtstart)
      : new Date();

    // Map frequency
    const freqMap: Record<number, "YEARLY" | "MONTHLY" | "WEEKLY" | "DAILY"> = {
      [RRule.YEARLY]: "YEARLY",
      [RRule.MONTHLY]: "MONTHLY",
      [RRule.WEEKLY]: "WEEKLY",
      [RRule.DAILY]: "DAILY",
    };
    const frequency = freqMap[options.freq!];

    // Extract interval (default to 1 if not specified)
    const interval = options.interval || 1;

    // Extract byweekday for WEEKLY frequency
    const byweekday: string[] = [];
    if (options.byweekday && Array.isArray(options.byweekday)) {
      options.byweekday.forEach((wd: any) => {
        const weekdayMap: Record<number, string> = {
          0: "MO",
          1: "TU",
          2: "WE",
          3: "TH",
          4: "FR",
          5: "SA",
          6: "SU",
        };
        // Handle both Weekday objects and numbers
        const dayNum = typeof wd === "number" ? wd : wd.weekday;
        if (weekdayMap[dayNum]) {
          byweekday.push(weekdayMap[dayNum]);
        }
      });
    }

    // Extract bymonthday
    const bymonthday =
      Array.isArray(options.bymonthday) && options.bymonthday.length > 0
        ? options.bymonthday[0]
        : 1;

    // Extract bysetpos and determine mode for MONTHLY/YEARLY
    const bysetpos =
      Array.isArray(options.bysetpos) && options.bysetpos.length > 0
        ? options.bysetpos[0]
        : 1;

    // Extract byweekdayMonth for "on_the" mode
    let byweekdayMonth = "MO";
    if (frequency === "MONTHLY" || frequency === "YEARLY") {
      if (Array.isArray(options.byweekday) && options.byweekday.length > 0) {
        const wd = options.byweekday[0];
        const dayNum = typeof wd === "number" ? wd : (wd as Weekday).weekday;
        const weekdayMap: Record<number, string> = {
          0: "MO",
          1: "TU",
          2: "WE",
          3: "TH",
          4: "FR",
          5: "SA",
          6: "SU",
        };
        byweekdayMonth = weekdayMap[dayNum] || "MO";
      }
    }

    // Determine monthlyMode
    const monthlyMode: "on" | "on_the" =
      frequency === "MONTHLY" &&
      Array.isArray(options.bymonthday) &&
      options.bymonthday.length > 0
        ? "on"
        : "on_the";

    // Extract month for YEARLY
    const month =
      Array.isArray(options.bymonth) && options.bymonth.length > 0
        ? options.bymonth[0]
        : 1;

    // Determine yearlyMode
    const yearlyMode: "on" | "on_the" =
      frequency === "YEARLY" &&
      Array.isArray(options.bymonthday) &&
      options.bymonthday.length > 0
        ? "on"
        : "on_the";

    // Determine endMode and extract count/until
    let endMode: "never" | "after" | "on" = "never";
    let count = 1;
    let until: Date | undefined = undefined;

    if (options.count) {
      endMode = "after";
      count = options.count;
    } else if (options.until) {
      endMode = "on";
      until = new Date(options.until);
    }

    return {
      scheduleDate,
      frequency,
      interval,
      byweekday,
      bymonthday,
      bysetpos,
      byweekdayMonth,
      monthlyMode,
      yearlyMode,
      month,
      endMode,
      count,
      until,
    };
  } catch (error) {
    console.error("Error parsing RRULE:", error);
    // Return defaults on parse error
    return {
      scheduleDate: new Date(),
      frequency: "DAILY",
      interval: 1,
      byweekday: [],
      bymonthday: 1,
      bysetpos: 1,
      byweekdayMonth: "MO",
      monthlyMode: "on",
      yearlyMode: "on",
      month: 1,
      endMode: "never",
      count: 1,
    };
  }
};
