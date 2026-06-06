import type { UserPreferences } from "@zenflow/shared";

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
  /** Top offset (px) where the working window begins. */
  workStartPx: number;
  /** Top offset (px) where the working window ends. */
  workEndPx: number;
}

/**
 * Compute the work-window bands for a given calendar date. Coordinates are in
 * grid pixels (midnight = 0), matching how blocks and the now-indicator are
 * positioned. `workStart`/`workEnd` are minutes from midnight in wall-clock.
 */
export function getDayZones(
  date: Date,
  prefs: Pick<UserPreferences, "workStart" | "workEnd" | "workDays">,
): DayZones {
  // date-fns/JS getDay(): 0=Sun…6=Sat → ISO: 1=Mon…7=Sun.
  const isoWeekday = date.getDay() === 0 ? 7 : date.getDay();
  return {
    isWorkDay: prefs.workDays.includes(isoWeekday),
    workStartPx: (prefs.workStart / 60) * HOUR_PX,
    workEndPx: (prefs.workEnd / 60) * HOUR_PX,
  };
}
