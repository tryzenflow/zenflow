import { localDateStr } from "../scheduler/slot";
import { minutesToUtc } from "../common/utils";

/**
 * Virtual clock for the ~1-year simulation window.
 *
 * Pure: every instant the runner feeds into the real services (`now`, event
 * `occurredAt`, completion times) is derived here from a fixed start date + a
 * day index, never from `Date.now()`. The clock reasons in a persona's IANA
 * timezone so that "day D, 09:15" is the right wall-clock instant for that user.
 *
 * The span is divided into:
 *  - warmup: first {@link WARMUP_DAYS} (lighter volume),
 *  - steady state: the bulk of the year,
 *  - tail: final {@link TAIL_DAYS} held out for the Phase-4 cold-start backtest.
 */

export const WARMUP_DAYS = 14;
export const TAIL_DAYS = 28;

export type Phase = "warmup" | "steady" | "tail";

export class SimClock {
  /** Local 'YYYY-MM-DD' of day 0, in UTC (the canonical span anchor). */
  private readonly startStr: string;

  constructor(
    startDate: string,
    readonly spanDays: number,
  ) {
    // Normalise to a pure date string; the per-persona tz is applied when an
    // absolute instant is requested.
    this.startStr = startDate;
  }

  /** Local 'YYYY-MM-DD' for day index `day`. */
  dateStr(day: number): string {
    const [y, m, d] = this.startStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + day);
    return dt.toISOString().slice(0, 10);
  }

  /** Start-of-day UTC instant for `day` in the given timezone. */
  dayStart(day: number, timezone: string): Date {
    return minutesToUtc(this.dateStr(day), 0, timezone);
  }

  /** Absolute UTC instant for `day` at `minuteOfDay` (in the persona's tz). */
  at(day: number, minuteOfDay: number, timezone: string): Date {
    return minutesToUtc(this.dateStr(day), Math.floor(minuteOfDay), timezone);
  }

  /** Last instant of `day` (23:59:59.999 local) — the day-settle cutoff. */
  endOf(day: number, timezone: string): Date {
    return new Date(this.dayStart(day + 1, timezone).getTime() - 1);
  }

  /** ISO weekday for `day`: 1=Mon … 7=Sun. */
  isoWeekday(day: number): number {
    const [y, m, d] = this.dateStr(day).split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 0 ? 7 : dow;
  }

  /** Day-of-year offset within the simulated span (0-based). */
  dayOfYear(day: number): number {
    return day;
  }

  /** Which time-model phase `day` falls in. */
  phase(day: number): Phase {
    if (day < WARMUP_DAYS) return "warmup";
    if (day >= this.spanDays - TAIL_DAYS) return "tail";
    return "steady";
  }

  /**
   * The 2-week sprint phase in [0, 1): 0 = sprint start, ~1 = just before the
   * cycle boundary. Deadline density and crammer volume spike near 1.
   */
  sprintPhase(day: number): number {
    return (day % 14) / 14;
  }

  /**
   * A smooth yearly seasonality multiplier in roughly [0.6, 1.2]: a quieter
   * mid-year holiday stretch and busier quarter-ends, layered on the sprint
   * cadence. Pure function of the day index.
   */
  seasonality(day: number): number {
    const frac = (day % 365) / 365;
    // Two cosine bumps: a mid-year dip, a year-end lift.
    const dip = -0.2 * Math.cos(2 * Math.PI * (frac - 0.5));
    const quarter = 0.1 * Math.cos(2 * Math.PI * 4 * frac);
    return 1 + dip + quarter;
  }

  /** Convenience: the local date string for an arbitrary instant + tz. */
  static localDate(instant: Date, timezone: string): string {
    return localDateStr(instant, timezone);
  }
}
