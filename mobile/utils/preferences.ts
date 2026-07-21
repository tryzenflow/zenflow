/** ISO weekdays (1=Mon … 7=Sun) with short labels — Monday-first. */
export const DAYS = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

/** The 12 selectable hours on a 12-hour clock (1 … 12). */
export const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The four selectable minutes, matching the scheduler's 15-minute slot grid. */
export const MINUTE_OPTIONS = [0, 15, 30, 45];

/** The two selectable meridiem periods. */
export const PERIOD_OPTIONS = ["AM", "PM"] as const;

/** Every 30-minute mark across a day (0, 30, …, 1410), for the work-hours picker. */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);

/** Format minutes-from-midnight as a 12-hour clock label, e.g. "9:00 AM". */
export function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

/**
 * Effective working minutes for a window. Wraps past midnight iff
 * `end <= start`, in which case the window runs into the next calendar day.
 */
export function workWindowMinutes(start: number, end: number) {
  return end > start ? end - start : 1440 - start + end;
}

/** Valid iff start≠end and the window covers at least 60 effective minutes. */
export function isValidWindow(start: number, end: number) {
  return start !== end && workWindowMinutes(start, end) >= 60;
}

/** True when the window crosses midnight (end on the next calendar day). */
export function windowWraps(start: number, end: number) {
  return end <= start;
}
