import { expandRrule, occurrenceId } from "../../scheduler/core/recurrence";

/** Session types the morning brief counts. Classes are lectures and exams; study blocks are tasks and assignments. */
export const BRIEF_CLASS_TYPES = ["LECTURE", "EXAM"] as const;
export const BRIEF_BLOCK_TYPES = ["TASK", "ASSIGNMENT"] as const;
export const BRIEF_TYPES = [...BRIEF_CLASS_TYPES, ...BRIEF_BLOCK_TYPES];

/** The subset of a `Session` row (plus its series) that the day expansion reads. */
export interface DayRow {
  id: string;
  title: string;
  type: string;
  scheduledStartTime: Date | null;
  durationMinutes: number;
  /** Plain-row state; a recurring representative's own state is unused. */
  completedAt: Date | null;
  skipped: boolean;
  seriesId: string | null;
  series: { rrule: string | null; exdates: string[] } | null;
}

/** One session occurrence on a given day. */
export interface DayItem {
  /** Plain session id, or `<seriesId>::<startISO>` for a recurring occurrence. */
  id: string;
  title: string;
  type: string;
  start: Date;
  durationMinutes: number;
  done: boolean;
  skipped: boolean;
}

/** Per-occurrence state of recurring series, keyed by `<seriesId>|<startISO>`. */
export type OccurrenceStates = Map<
  string,
  { completedAt: Date | null; skipped: boolean }
>;

export const occurrenceStateKey = (seriesId: string, start: Date): string =>
  `${seriesId}|${start.toISOString()}`;

/**
 * Every occurrence starting in `[rangeStart, rangeEnd)`: plain rows whose
 * start falls in the range, and each occurrence of a recurring series.
 * Sorted by start.
 */
export function expandDayItems(
  rows: DayRow[],
  states: OccurrenceStates,
  rangeStart: Date,
  rangeEnd: Date,
  tz: string,
): DayItem[] {
  const items: DayItem[] = [];
  for (const row of rows) {
    if (!row.scheduledStartTime) continue;
    const rrule = row.series?.rrule;
    if (rrule && row.seriesId) {
      const starts = expandRrule(
        rrule,
        row.scheduledStartTime,
        rangeStart,
        rangeEnd,
        tz,
        row.series?.exdates ?? [],
      );
      for (const start of starts) {
        const state = states.get(occurrenceStateKey(row.seriesId, start));
        items.push({
          id: occurrenceId(row.seriesId, start),
          title: row.title,
          type: row.type,
          start,
          durationMinutes: row.durationMinutes,
          done: !!state?.completedAt,
          skipped: !!state?.skipped,
        });
      }
      continue;
    }
    const start = row.scheduledStartTime;
    if (start < rangeStart || start >= rangeEnd) continue;
    items.push({
      id: row.id,
      title: row.title,
      type: row.type,
      start,
      durationMinutes: row.durationMinutes,
      done: !!row.completedAt,
      skipped: row.skipped,
    });
  }
  return items.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Morning brief counts over the items that are not skipped. */
export function briefCounts(items: DayItem[]): {
  classes: number;
  blocks: number;
  first: DayItem | null;
} {
  const live = items.filter((i) => !i.skipped);
  return {
    classes: live.filter((i) =>
      (BRIEF_CLASS_TYPES as readonly string[]).includes(i.type),
    ).length,
    blocks: live.filter((i) =>
      (BRIEF_BLOCK_TYPES as readonly string[]).includes(i.type),
    ).length,
    first: live[0] ?? null,
  };
}

/** Evening check-in targets: items not yet marked done or missed. */
export function pendingCheckIn(items: DayItem[]): DayItem[] {
  return items.filter((i) => !i.done && !i.skipped);
}

/** `true` when a DND occurrence overlaps `[dayStart, dayEnd)`. */
export function dndCoversDay(
  dnd: DayItem[],
  dayStart: Date,
  dayEnd: Date,
): boolean {
  return dnd.some(
    (d) =>
      d.start < dayEnd &&
      d.start.getTime() + d.durationMinutes * 60_000 > dayStart.getTime(),
  );
}
