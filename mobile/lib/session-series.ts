import type { Session } from "@zenflow/shared";

/**
 * Which kind of series (if any) a session belongs to (CLAUDE.md invariant
 * #4). `seriesId` is set for both:
 * - a recurring **fixed** series (`rrule` set) — virtual occurrences, scope
 *   choices are "this occurrence" / truncate the rrule / delete the series;
 * - a materialized multi-sitting **TASK** series (`rrule` null,
 *   `sessionTotal` set instead) — real rows, scope choices are "this
 *   sitting" / delete it and later sittings by `sessionIndex` / delete the
 *   series.
 *
 * `"none"` covers a one-off fixed session or a single-sitting TASK — no
 * scope choice needed, delete is always just that one row.
 */
export type SeriesKind = "none" | "recurring" | "task";

export function getSeriesKind(
  task: Pick<Session, "seriesId" | "rrule">,
): SeriesKind {
  if (!task.seriesId) return "none";
  return task.rrule ? "recurring" : "task";
}
