// types.ts or schema.ts
import * as z from "zod";
import { DAILY_HORIZON, TIME_GRANULARITY } from "./constants";
import { deleteData, getData, postData } from "@/api";
import { Task } from "@/types/tasks";
import { extractFileIdsFromNoteContent } from "./files";
import { rrulestr, RRule, Weekday } from "rrule";
import { endOfMonth, endOfWeek } from "date-fns";
import type { RecurrenceScope, ViewMode } from "@zenflow/shared";

export const taskSchema = z.object({
  title: z.string().min(1, { error: "Task name is required" }),
  duration: z
    .int()
    .min(TIME_GRANULARITY, {
      error: `Task duration must be at least ${TIME_GRANULARITY} minutes`,
    })
    .max(DAILY_HORIZON, { error: "Task duration must be at most 24 hours" }),
  tags: z.string().optional(),
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
  isRecurring: z.boolean().default(false),
  deadlineTime: z.string().optional(),
  note: z.string().optional(),
  /**
   * View-scoped recurrence shape:
   *  - "interval" → Week: "Every X days" (FREQ=DAILY;INTERVAL=X) · Month:
   *    "Days of week" (BYDAY weekday chips across the whole month)
   *  - "specific" → Week: "Specific days" (BYDAY) · Month: "Specific weeks" (byweeks)
   */
  recurrenceMode: z.enum(["interval", "specific"]).default("specific"),
  /** Month "Specific weeks": ordinal week-of-month positions (1..5). */
  byweeks: z.array(z.number()).default([1]),
  frequency: z.enum(["YEARLY", "MONTHLY", "WEEKLY", "DAILY"]),
  interval: z.number().min(1),
  byday: z.array(z.string()),
  bymonthday: z.number().min(1).max(31),
  bysetpos: z.number(),
  bydayMonth: z.string(),
  monthlyMode: z.enum(["on", "on_the"]),
  yearlyMode: z.enum(["on", "on_the"]),
  month: z.number().min(1).max(12),
  endMode: z.enum(["never", "after", "on"]),
  count: z.number().min(1),
  until: z.date().optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;
export type EditTaskFormValues = TaskFormValues;

/** Parse the comma-separated tags input into a clean string array. */
export function parseTags(input?: string): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function deleteTask(taskId: string, scope?: RecurrenceScope) {
  const { data } = await getData<{ data: { task: Task } }>(`/tasks/${taskId}`);
  const previousIds = extractFileIdsFromNoteContent(data.task.note || "");
  if (previousIds.length > 0) {
    await postData("/files/remove", { ids: previousIds });
  }
  const qs = scope ? `?scope=${scope}` : "";
  return deleteData(`/tasks/${taskId}${qs}`);
}

/** ISO weekday (1=Mon … 7=Sun) → RFC 5545 BYDAY code. */
export const ISO_TO_BYDAY: Record<number, string> = {
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
  7: "SU",
};

/** Format a Date as an RFC 5545 UNTIL value: YYYYMMDDTHHMMSSZ. */
const toUntil = (d: Date) =>
  d.toISOString().split(".")[0].replace(/[-:]/g, "") + "Z";

export interface RRuleContext {
  /** Active calendar perspective; recurrence is scoped to its window. */
  view: ViewMode;
  /** A date inside the active window (anchors the week/month bounds). */
  date: Date;
  /** The user's onboarding workdays, ISO 1–7. */
  workDays: number[];
}

/**
 * Build a single-line, FREQ-based RRULE scoped to the active view's window.
 * The backend materializes one task row per occurrence (working days only) and
 * only understands a lone `RRULE:` line, so every branch emits one `FREQ=…`
 * rule bounded by `UNTIL`.
 *
 *  - Week · interval  → every X working days through the end of the week
 *  - Week · specific  → chosen weekdays (workdays) this week
 *  - Month · interval → "Days of week": the chosen weekdays (workdays) repeated
 *    across the whole month, encoded as a WEEKLY BYDAY rule bounded to the end
 *    of the month (e.g. Mon+Wed → `FREQ=WEEKLY;BYDAY=MO,WE`).
 *  - Month · specific → "Specific weeks": the chosen week ordinals, encoded as
 *    the BYDAY prefix of a MONTHLY rule (e.g. weeks 1,3 → `BYDAY=1MO,3MO`). The
 *    backend reads those ordinals and expands each to every working day of that
 *    week.
 */
export const generateRRule = (
  values: TaskFormValues,
  ctx: RRuleContext,
): string => {
  const { view, date, workDays } = ctx;
  // "Day" never recurs; treat as non-recurring.
  if (view === "day") return "";

  const firstWorkday = [...workDays].sort((a, b) => a - b)[0] ?? 1;
  const interval = Math.max(1, values.interval);

  // The window never extends past the deadline: an occurrence due-by date caps
  // the recurrence's UNTIL (the backend also enforces this defensively).
  const deadlineEnd = values.deadlineDate
    ? new Date(`${values.deadlineDate}T23:59:59`)
    : null;
  const untilFor = (windowEnd: Date) =>
    toUntil(deadlineEnd && deadlineEnd < windowEnd ? deadlineEnd : windowEnd);

  // Selected weekdays constrained to workdays, falling back to the first
  // workday when none remain. Shared by the week and month "specific" branches.
  const specificByday = (): string => {
    const workdayCodes = workDays.map((d) => ISO_TO_BYDAY[d]);
    const days = values.byday.filter((d) => workdayCodes.includes(d));
    return (days.length ? days : [ISO_TO_BYDAY[firstWorkday]]).join(",");
  };

  if (view === "week") {
    const until = untilFor(endOfWeek(date, { weekStartsOn: 1 }));
    if (values.recurrenceMode === "interval") {
      return `RRULE:FREQ=DAILY;INTERVAL=${interval};UNTIL=${until}`;
    }
    return `RRULE:FREQ=WEEKLY;BYDAY=${specificByday()};UNTIL=${until}`;
  }

  // view === "month"
  const until = untilFor(endOfMonth(date));
  if (values.recurrenceMode === "interval") {
    // "Days of week" → chosen weekdays repeated across the whole month window.
    return `RRULE:FREQ=WEEKLY;BYDAY=${specificByday()};UNTIL=${until}`;
  }
  // "Specific weeks" → Nth <first workday> of the month (e.g. 1MO,3MO).
  const wd = ISO_TO_BYDAY[firstWorkday];
  const weeks = values.byweeks.length ? values.byweeks : [1];
  const byday = weeks.map((n) => `${n}${wd}`).join(",");
  return `RRULE:FREQ=MONTHLY;BYDAY=${byday};UNTIL=${until}`;
};

export const parseRRule = (rruleString: string): Partial<TaskFormValues> => {
  try {
    // Parse the RRULE string
    const rule = rrulestr(rruleString);
    const options = rule.origOptions;

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

    // Extract byday for WEEKLY frequency
    const byday: string[] = [];
    if (options.byweekday && Array.isArray(options.byweekday)) {
      options.byweekday.forEach((wd: any) => {
        const dayMap: Record<number, string> = {
          0: "MO",
          1: "TU",
          2: "WE",
          3: "TH",
          4: "FR",
          5: "SA",
          6: "SU",
        };
        // Handle both Weekday objects and numbers
        const dayNum = typeof wd === "number" ? wd : wd.day;
        if (dayMap[dayNum]) {
          byday.push(dayMap[dayNum]);
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

    // Extract bydayMonth for "on_the" mode
    let bydayMonth = "MO";
    if (frequency === "MONTHLY" || frequency === "YEARLY") {
      if (Array.isArray(options.byweekday) && options.byweekday.length > 0) {
        const wd = options.byweekday[0];
        const dayNum = typeof wd === "number" ? wd : (wd as Weekday).weekday;
        const dayMap: Record<number, string> = {
          0: "MO",
          1: "TU",
          2: "WE",
          3: "TH",
          4: "FR",
          5: "SA",
          6: "SU",
        };
        bydayMonth = dayMap[dayNum] || "MO";
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
      frequency,
      interval,
      byday,
      bymonthday,
      bysetpos,
      bydayMonth,
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
      frequency: "DAILY",
      interval: 1,
      byday: [],
      bymonthday: 1,
      bysetpos: 1,
      bydayMonth: "MO",
      monthlyMode: "on",
      yearlyMode: "on",
      month: 1,
      endMode: "never",
      count: 1,
    };
  }
};

export const rruleCoversDate = (
  rruleString: string,
  date: Date,
  opts?: { mode?: "day" | "exact"; timezone?: "local" | "utc" },
): boolean => {
  const { mode = "day", timezone = "local" } = opts || {};

  try {
    const rule = rrulestr(rruleString); // rrulestr can return RRule or RRuleSet

    if (mode === "exact") {
      // Use .before(date, true) which returns the occurrence equal to date if it exists (inc=true)
      if (typeof rule.before === "function") {
        const occ = rule.before(date, true);
        return !!(occ && occ.getTime() === date.getTime());
      }
      return false;
    }

    // mode === "day"
    let start: Date;
    let end: Date;
    if (timezone === "utc") {
      // Create UTC start/end of the given date
      start = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );
      end = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
    } else {
      // Local start/end of the given date
      start = new Date(date);
      start.setHours(0, 0, 0, 0);
      end = new Date(date);
      end.setHours(23, 59, 59, 999);
    }

    if (typeof rule.between === "function") {
      const occs = rule.between(start, end, true);
      return Array.isArray(occs) && occs.length > 0;
    }

    return false;
  } catch (err) {
    // If parsing fails, treat as not covering the date
    console.error("rruleCoversDate: failed to parse rrule:", err);
    return false;
  }
};
