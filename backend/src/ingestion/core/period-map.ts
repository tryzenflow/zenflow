/**
 * DLU teaching periods ("tiết") → wall-clock minutes from midnight.
 *
 * The portal timetable never returns times: a row says `PeriodID: 1,
 * NumberOfPeriods: 4` and the student is expected to know that means
 * 07:30–11:15. The mapping is fixed by the university and captured in
 * `INTEGRATION_DOCS.md`. Periods are 45 or 60 minutes, not a uniform 50, and
 * every boundary lands on the 15-minute grid:
 *
 * ```
 *   periods  1– 4   07:30 – 11:15   60/45 · 15-min break · 60/45
 *   periods  7–10   13:00 – 16:30   45/60/60/45, no break
 *   periods 11–14   16:45 – 20:00   45/60/45/45, no break
 * ```
 *
 * **Periods 5 and 6 are undocumented** — they sit in the 11:15–13:00 lunch gap
 * and we have never seen a row use them. Rather than invent times, anything
 * touching them (or any other unknown period) maps to `null`; the caller skips
 * the row and records the reason on the job item. Guessing here would silently
 * put a class on the calendar at the wrong hour, which is strictly worse than
 * not putting it there at all.
 *
 * Pure: a lookup table and integer arithmetic.
 */

/** Wall-clock span of a lecture, minutes from local midnight, half-open. */
export interface PeriodSpan {
  startMin: number;
  /** Exclusive; the raw (un-snapped) end — see `grid.ts`. */
  endMin: number;
}

const hm = (hours: number, minutes: number) => hours * 60 + minutes;

/**
 * Start/end of each individual period. The morning break lives *between*
 * entries, which is why a span cannot simply be `end - start`: periods 1–4
 * cover 225 minutes of wall clock for 210 minutes of teaching.
 */
const PERIODS: ReadonlyMap<number, PeriodSpan> = new Map([
  // Morning block — 15-minute break between periods 2 and 3.
  [1, { startMin: hm(7, 30), endMin: hm(8, 30) }],
  [2, { startMin: hm(8, 30), endMin: hm(9, 15) }],
  [3, { startMin: hm(9, 30), endMin: hm(10, 30) }],
  [4, { startMin: hm(10, 30), endMin: hm(11, 15) }],
  // Afternoon block — contiguous, no break.
  [7, { startMin: hm(13, 0), endMin: hm(13, 45) }],
  [8, { startMin: hm(13, 45), endMin: hm(14, 45) }],
  [9, { startMin: hm(14, 45), endMin: hm(15, 45) }],
  [10, { startMin: hm(15, 45), endMin: hm(16, 30) }],
  // Evening block — no break.
  [11, { startMin: hm(16, 45), endMin: hm(17, 30) }],
  [12, { startMin: hm(17, 30), endMin: hm(18, 30) }],
  [13, { startMin: hm(18, 30), endMin: hm(19, 15) }],
  [14, { startMin: hm(19, 15), endMin: hm(20, 0) }],
]);

/**
 * Wall-clock span covered by `numberOfPeriods` consecutive periods starting at
 * `periodId`, or `null` if any period in the span is not in the table.
 *
 * Partial spans work (`periodId: 3, numberOfPeriods: 2` ⇒ 09:30–11:15), and so
 * do spans that straddle two blocks (10 → 11 crosses the 16:30–16:45 gap),
 * because the span is `[first.startMin, last.endMin)` and any intervening
 * break is simply included. A span that reaches across the undocumented
 * periods 5–6 (e.g. 4 → 7) is `null` by construction, which is the intent.
 *
 * The returned span is **raw** — this function does no grid-snapping. Every
 * boundary in the current period table happens to land on the 15-minute grid,
 * but callers must still run the span through {@link snapToGrid} (`grid.ts`)
 * before it becomes a session rather than rely on that.
 */
export function periodsToWallClock(
  periodId: number,
  numberOfPeriods: number,
): PeriodSpan | null {
  if (!Number.isInteger(periodId) || !Number.isInteger(numberOfPeriods)) {
    return null;
  }
  if (numberOfPeriods < 1) return null;

  const first = PERIODS.get(periodId);
  const last = PERIODS.get(periodId + numberOfPeriods - 1);
  if (!first || !last) return null;

  // Every period in between must be known too, or the span silently swallows
  // an undocumented one (4 + 4 would otherwise "work" as 10:30 → 13:45).
  for (let p = periodId + 1; p < periodId + numberOfPeriods - 1; p++) {
    if (!PERIODS.has(p)) return null;
  }

  return { startMin: first.startMin, endMin: last.endMin };
}
