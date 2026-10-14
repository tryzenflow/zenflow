import { formatInTimeZone } from "date-fns-tz";
import {
  STREAK_FREEZE_EVERY_DAYS,
  STREAK_MAX_FREEZES,
  type Streak,
} from "@zenflow/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of `instant` on the wall clock of `timezone`. */
export function dayKey(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Walk every day from the first active day to `today`. An active day extends
 * the streak and every {@link STREAK_FREEZE_EVERY_DAYS}th streak day banks a
 * freeze (max {@link STREAK_MAX_FREEZES}). A missed past day spends a freeze,
 * else resets the streak. `today` itself never breaks it. Pure.
 */
export function computeStreak(
  activeDays: Iterable<string>,
  today: string,
): Streak {
  const active = new Set(activeDays);
  const sorted = [...active].filter((d) => d <= today).sort();
  const streak: Streak = {
    current: 0,
    longest: 0,
    freezesAvailable: 0,
    frozenDays: [],
    lastActiveDay: sorted.at(-1) ?? null,
    todayDone: active.has(today),
  };
  if (sorted.length === 0) return streak;

  for (let day = sorted[0]; day <= today; day = nextDay(day)) {
    if (active.has(day)) {
      streak.current += 1;
      streak.longest = Math.max(streak.longest, streak.current);
      if (
        streak.current % STREAK_FREEZE_EVERY_DAYS === 0 &&
        streak.freezesAvailable < STREAK_MAX_FREEZES
      )
        streak.freezesAvailable += 1;
    } else if (day === today || streak.current === 0) {
      continue;
    } else if (streak.freezesAvailable > 0) {
      streak.freezesAvailable -= 1;
      streak.frozenDays.push(day);
    } else {
      streak.current = 0;
      streak.frozenDays = [];
    }
  }
  return streak;
}
