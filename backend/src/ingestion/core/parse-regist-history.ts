import type { SkippedItem } from "./types";

/**
 * DKHP **registration history** → a confirmed section set (issue #56).
 *
 * The timetable endpoint answers per student and per week, so the only way to
 * learn which sections a student is in used to be to walk their whole term. One
 * DKHP call (`POST /api/student/getAllRegistHistory`, body `{p1: year, p2:
 * term}`) answers it instead.
 *
 * ## An event log, not a state
 *
 * Each row is one registration *event*: `Status: 1` registered, `Status: 0`
 * cancelled. A section that was registered and later cancelled has both rows, so
 * dropping `Status: 0` rows alone would keep it as enrolled. The rule is: group
 * by `CurriculumID`, take the latest event by `UpdateDate`, keep the section
 * only if that event is `Status: 1`. Registering again after a cancel works for
 * free.
 *
 * `CurriculumID` has the same shape as the timetable's `ScheduleStudyUnitID`
 * (`25120CT210102`) and is treated as that section id.
 *
 * Pure: no clock, no I/O. The term to match is always a parameter.
 */

/** One registration event (the fields we read). */
export interface PortalRegistHistoryRow {
  /** The section — what discovery is actually after. */
  CurriculumID?: string | null;
  /** `"Thiết kế Web ()"` — a stray `()` or `(DKHP_WIN)` suffix is common. */
  CurriculumName?: string | null;
  /** `1` registered, `0` cancelled. */
  Status?: number | string | null;
  /** `"2025-07-24 17:25:28"` — wall-clock, sortable as text. */
  UpdateDate?: string | null;
  YearStudy?: string | null;
  TermID?: string | null;
}

/** A section discovery is confident the student is currently registered in. */
export interface ConfirmedSection {
  scheduleStudyUnitId: string;
  curriculumId: string | null;
  curriculumName: string | null;
  yearStudy: string;
  termId: string;
}

/** What {@link parseRegistHistory} found. */
export interface ParsedRegistHistory {
  sections: ConfirmedSection[];
  skipped: SkippedItem[];
}

/** Trimmed value, or `null` for absent/blank — the portal uses `""` for both. */
function orNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** `"Thiết kế Web ()"` / `"Tư tưởng Hồ Chí Minh (DKHP_WIN)"` → the bare name. */
function cleanName(value: string | null | undefined): string | null {
  const name = orNull(value)?.replace(/\s*\([^()]*\)\s*$/, "");
  return name?.trim() || null;
}

/**
 * The sections a student is currently registered in for `term`.
 *
 * Rows outside the resolved year/term are ignored. Rows without a
 * `CurriculumID`, or without a usable `Status`, go to `skipped`. On equal
 * `UpdateDate` the later row in the response wins.
 */
export function parseRegistHistory(
  rows: readonly PortalRegistHistoryRow[] | null | undefined,
  term: { academicYear: string; termId: string },
): ParsedRegistHistory {
  const latest = new Map<
    string,
    { row: PortalRegistHistoryRow; at: string; registered: boolean }
  >();
  const skipped: SkippedItem[] = [];

  for (const row of rows ?? []) {
    if (orNull(row?.YearStudy) !== term.academicYear) continue;
    if (orNull(row?.TermID) !== term.termId) continue;

    const id = orNull(row?.CurriculumID);
    if (!id) {
      skipped.push({
        ref: `dkhp:history:${orNull(row?.CurriculumName) ?? "unknown"}`,
        reason: "registration row has no CurriculumID",
      });
      continue;
    }

    // `Status` has been seen as a number; tolerate a numeric string.
    const raw = row?.Status;
    const status = raw === null || raw === undefined ? NaN : Number(raw);
    if (status !== 0 && status !== 1) {
      skipped.push({
        ref: `dkhp:history:${id}`,
        reason: "registration row has no usable Status",
      });
      continue;
    }

    const at = orNull(row?.UpdateDate) ?? "";
    const prev = latest.get(id);
    if (prev && prev.at > at) continue;
    latest.set(id, { row, at, registered: status === 1 });
  }

  const sections: ConfirmedSection[] = [];
  for (const [id, { row, registered }] of latest) {
    if (!registered) continue;
    sections.push({
      scheduleStudyUnitId: id,
      curriculumId: id,
      curriculumName: cleanName(row.CurriculumName),
      // Taken from the matched coordinates, not the row.
      yearStudy: term.academicYear,
      termId: term.termId,
    });
  }
  return { sections, skipped };
}
