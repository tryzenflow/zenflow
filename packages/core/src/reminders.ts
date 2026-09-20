import { MAX_REMINDERS_PER_SESSION, MAX_REMINDER_MINUTES } from "@zenflow/shared";

/** Quick-pick lead times (minutes before start); 0 = at the start time. */
export const REMINDER_PRESETS = [0, 15, 30, 60, 120, 1440, 2880, 4320, 10080] as const;

export const REMINDER_UNITS = [
  { id: "min", label: "minutes", minutes: 1 },
  { id: "hour", label: "hours", minutes: 60 },
  { id: "day", label: "days", minutes: 1440 },
  { id: "week", label: "weeks", minutes: 10080 },
] as const;

export type ReminderUnitId = (typeof REMINDER_UNITS)[number]["id"];

/** 0 → "At start", 15 → "15 min", 60 → "1 hour", 2880 → "2 days". */
export function reminderLeadLabel(minutes: number): string {
  if (minutes === 0) return "At start";
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return `${minutes} min`;
}

/** Chip text: "At start time" / "1 hour before". */
export function reminderLabel(minutes: number): string {
  return minutes === 0
    ? "At start time"
    : `${reminderLeadLabel(minutes)} before`;
}

/** Custom `amount` × `unitMinutes` → whole minutes (NaN-safe). */
export function customReminderMinutes(
  amount: string,
  unitMinutes: number,
): number {
  return Math.round(Number(amount) * unitMinutes);
}

/**
 * Why `minutes` can't be set as a reminder, or `null` if it can. `others` is
 * the list without the reminder being edited, so re-saving an unchanged value
 * is fine while a second reminder at the same lead time is not.
 */
export function reminderError(
  minutes: number,
  others: readonly number[],
): string | null {
  if (!Number.isFinite(minutes) || minutes < 0) return "Enter a valid time.";
  if (minutes > MAX_REMINDER_MINUTES) return "Up to 7 days before.";
  if (others.includes(minutes)) return "You already have a reminder then.";
  return null;
}

/**
 * Add `minutes`, or — when `replacing` is given — swap that reminder for it in
 * place. Kept sorted longest-lead first, never duplicated, never over the cap.
 */
export function upsertReminder(
  list: readonly number[],
  minutes: number,
  replacing?: number,
): number[] {
  const others = list.filter((m) => m !== replacing);
  if (others.includes(minutes)) return [...list];
  if (replacing === undefined && others.length >= MAX_REMINDERS_PER_SESSION) {
    return [...list];
  }
  return [...others, minutes].sort((a, b) => b - a);
}
