import { RRule } from "rrule";
import { minutesToUtc, utcToMinutes } from "../../common/utils";
import { localDateStr } from "../../scheduler/slot";

interface RecurringTask {
  rrule: string;
  fixed: boolean;
  startTime: number;
  scheduledStartTime: Date | null;
  createdAt: Date;
}

/**
 * Virtually expand a recurring task into the concrete occurrence start times
 * that fall within [windowStart, windowEnd] (Phase 1: display-only — no
 * occurrence is persisted). Each occurrence keeps the series' time-of-day.
 */
export function expandRecurring(
  task: RecurringTask,
  windowStart: Date,
  windowEnd: Date,
  timezone: string,
): Date[] {
  if (!task.rrule) return [];

  let rule: RRule;
  try {
    const body = task.rrule
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^RRULE[:;]/i.test(l))
      ?.replace(/^RRULE:/i, "") ?? task.rrule;
    const options = RRule.parseString(body);
    options.dtstart = task.scheduledStartTime ?? task.createdAt;
    rule = new RRule(options);
  } catch {
    return [];
  }

  const todMinutes = task.fixed
    ? task.startTime
    : task.scheduledStartTime
      ? utcToMinutes(task.scheduledStartTime, timezone)
      : 0;

  return rule
    .between(windowStart, windowEnd, true)
    .map((d) => minutesToUtc(localDateStr(d, timezone), todMinutes, timezone));
}
