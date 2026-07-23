import type { UserPreferences } from "@zenflow/shared";
import { subDays } from "date-fns";

/** Pixel height of one hour row in the day/week time grid. */
export const HOUR_PX = 64;
/** Total height of a full 24h day column. */
export const DAY_PX = HOUR_PX * 24;

/** Sensible defaults for an unauthenticated / still-loading user. */
export const DEFAULT_WORK_PREFS: Pick<
  UserPreferences,
  "workStart" | "workEnd" | "workDays"
> = {
  workStart: 540, // 09:00
  workEnd: 1020, // 17:00
  workDays: [1, 2, 3, 4, 5], // Mon–Fri (ISO)
};

export interface DayZones {
  /** Whether this calendar date is one of the user's working days. */
  isWorkDay: boolean;
  /**
   * Work-hour bands for this column, in grid px (midnight = 0). May contain
   * 0, 1, or 2 segments — two when an overnight (cross-midnight) window means
   * this day shows both a morning spill-over and an evening shift.
   */
  segments: { topPx: number; bottomPx: number }[];
}

/** ISO weekday (1=Mon … 7=Sun) for a JS Date. */
function isoWeekday(date: Date) {
  // date-fns/JS getDay(): 0=Sun…6=Sat → ISO: 1=Mon…7=Sun.
  return date.getDay() === 0 ? 7 : date.getDay();
}

/**
 * Compute the work-window bands for a given calendar date. Coordinates are in
 * grid pixels (midnight = 0), matching how blocks and the now-indicator are
 * positioned. `workStart`/`workEnd` are minutes from midnight in wall-clock.
 *
 * Wrap convention: a window wraps past midnight iff `workEnd <= workStart`. A
 * shift is anchored to its **start day**, so for date D the work zone is the
 * union of D's evening segment (`[workStart, 1440]`, if D is a workday) and the
 * previous day's overnight spill-over into D's morning (`[0, workEnd]`, if D-1
 * is a workday). Non-wrapping windows keep the simple `[workStart, workEnd]`
 * band on workdays.
 */
export function getDayZones(
  date: Date,
  prefs: Pick<UserPreferences, "workStart" | "workEnd" | "workDays">,
): DayZones {
  const todayWork = prefs.workDays.includes(isoWeekday(date));
  const prevWork = prefs.workDays.includes(isoWeekday(subDays(date, 1)));

  const workStartPx = (prefs.workStart / 60) * HOUR_PX;
  const workEndPx = (prefs.workEnd / 60) * HOUR_PX;
  const wraps = prefs.workEnd <= prefs.workStart;

  const segments: DayZones["segments"] = [];

  if (wraps) {
    // Evening segment: this day's shift starts in the evening and runs to midnight.
    if (todayWork) segments.push({ topPx: workStartPx, bottomPx: DAY_PX });
    // Morning segment: the previous day's overnight shift spills into this morning.
    if (prevWork) segments.push({ topPx: 0, bottomPx: workEndPx });
  } else if (todayWork) {
    segments.push({ topPx: workStartPx, bottomPx: workEndPx });
  }

  return { isWorkDay: todayWork, segments };
}
