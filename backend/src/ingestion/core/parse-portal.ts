import { minutesToUtc } from "../../common/utils";
import {
  legacyPortalMeetingKey,
  portalExamKey,
  portalLectureKey,
  unkeyablePortalLectureRef,
} from "./external-key";
import { snapToGrid } from "./grid";
import { periodsToWallClock } from "./period-map";
import type {
  ParsedPortalItem,
  ParsedPortalSection,
  SkippedItem,
} from "./types";

/**
 * DLU student-portal payloads → calendar blocks.
 *
 * Two endpoints, two shapes:
 *
 *  - `GET /api/student/DrawingStudentSchedules?academicYear&semester&tuan` — one row per
 *    class **meeting** in one ISO week. Times are expressed as teaching periods
 *    (`PeriodID` + `NumberOfPeriods`), never as clock times, so `period-map.ts`
 *    has to translate them.
 *  - `GET /api/student/exam?academicYear&semester` — one row per exam, with real
 *    Vietnamese-formatted date/time strings (`"01/12/2025"`, `"07g30"` — note
 *    the `g` separator, short for *giờ*) and a duration in minutes as a string.
 *
 * Both are **wall-clock in the university's timezone** with no offset
 * anywhere, so every instant is built with the house helper
 * {@link minutesToUtc} rather than hand-rolled timezone math.
 *
 * Pure: no clock (the date always comes from the row), no I/O, no randomness.
 */

/** One row of the `DrawingStudentSchedules` response (fields we read). */
export interface PortalTimetableRow {
  /**
   * The portal's per-meeting id. **Not** the `externalKey` source any more: it is
   * minted per (section, student), so keying on it made a lecture
   * student-specific and blocked the cross-student occurrence cache (issue #56,
   * see `external-key.ts`). Still read, to rename pre-#56 rows in place.
   */
  WeekScheduleID?: number | string | null;
  ScheduleStudyUnitID?: string | null;
  CurriculumName?: string | null;
  /** First teaching period of the meeting. */
  PeriodID?: number | null;
  NumberOfPeriods?: number | null;
  /** Meeting date, `dd/MM/yyyy`. */
  Ngay?: string | null;
  RoomID?: string | null;
  BuildingName?: string | null;
  CampusName?: string | null;
  /** Teacher. */
  FullName?: string | null;
  /** Academic year, `"2026-2027"`. */
  YearStudy?: string | null;
  /** `"HK01"` … */
  TermID?: string | null;
  /** Rendered HTML blob; the only place the curriculum id and group number appear. */
  TKHHienThi?: string | null;
}

/** One row of the `exam` response (fields we read). */
export interface PortalExamRow {
  /** Stable per-exam id — the `externalKey` source. */
  Examination?: number | string | null;
  ScheduleStudyUnitID?: string | null;
  CurriculumID?: string | null;
  CurriculumName?: string | null;
  /** Exam date, `dd/MM/yyyy`. */
  NgayThi?: string | null;
  /** Start time, `"07g30"`. */
  GioThi?: string | null;
  /** Duration in minutes, as a string: `"120"`. */
  ThoiLuong?: string | number | null;
  PhongThi?: string | null;
  DiaDiem?: string | null;
  /** Exam format, e.g. `"Thi máy"` / `"Tự luận"`. */
  HinhThucThi?: string | null;
}

/** Everything one week of the timetable yielded. */
export interface ParsedTimetable {
  items: ParsedPortalItem[];
  /** Distinct sections seen, for the `PortalSection` upsert. */
  sections: ParsedPortalSection[];
  skipped: SkippedItem[];
}

/** Everything one term's exam list yielded. */
export interface ParsedExams {
  items: ParsedPortalItem[];
  skipped: SkippedItem[];
}

/** `"17/08/2026"` → `"2026-08-17"`, or `null` if it is not that shape. */
function parseDdMmYyyy(value: string | null | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value?.trim() ?? "");
  if (!match) return null;
  const [, day, month, year] = match;
  if (+month < 1 || +month > 12 || +day < 1 || +day > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * `"07g30"` → 450 minutes from midnight. The portal writes the hour separator
 * as `g` (*giờ*); `:` and `h` are accepted too, since the same field has been
 * seen both ways across DLU screens.
 */
function parseGioThi(value: string | null | undefined): number | null {
  const match = /^(\d{1,2})\s*[gh:]\s*(\d{2})$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const hours = +match[1];
  const minutes = +match[2];
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Trimmed value, or `null` for absent/blank — the portal uses `""` for both. */
function orNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Pull the curriculum id and group number out of the rendered `TKHHienThi`
 * blob, the only field of a timetable row that carries them:
 *
 * ```html
 * <span …>Môn học Mẫu Một (10AB1001)</span><br/>
 * <span …>- Nhóm: 01</span><br/>…
 * ```
 *
 * Both are best-effort: a layout change upstream degrades these to `null`
 * rather than breaking the meeting itself.
 */
function parseDisplayBlob(html: string | null | undefined): {
  curriculumId: string | null;
  groupNo: string | null;
} {
  const source = html ?? "";
  return {
    curriculumId: /\(([A-Za-z0-9._-]+)\)\s*<\/span>/.exec(source)?.[1] ?? null,
    groupNo: orNull(/Nhóm:\s*([^<]*)/u.exec(source)?.[1]),
  };
}

/**
 * Parse one week of class meetings.
 *
 * One `Session` per meeting, `type: LECTURE` — faithful to a per-week API, and
 * it lets a room swap or a one-off cancellation show up naturally instead of
 * having to mutate a recurrence rule.
 *
 * A row is skipped (and the reason returned) when it lacks any of the three
 * fields the key is built from (`ScheduleStudyUnitID`, a parseable `Ngay`, a
 * `PeriodID` span `period-map.ts` accepts — the last of which today means
 * anything touching the undocumented periods 5–6).
 *
 * Note the narrowing since issue #56: a row with a usable date and period but no
 * `ScheduleStudyUnitID` used to still yield a meeting (with a null section id).
 * It cannot now — the section id is part of the key — so it is skipped instead.
 * No capture has ever shown such a row, and one could not participate in the
 * cross-student cache anyway, since the section is what students share.
 */
export function parseTimetable(
  rows: readonly PortalTimetableRow[] | null | undefined,
  timezone: string,
): ParsedTimetable {
  const items: ParsedPortalItem[] = [];
  const skipped: SkippedItem[] = [];
  const sections = new Map<string, ParsedPortalSection>();

  for (const row of rows ?? []) {
    // The section id leads now: it is the first component of the key, so a row
    // without one cannot be identified at all (see the note in the docblock).
    const sectionId = orNull(row?.ScheduleStudyUnitID);
    const ref = unkeyablePortalLectureRef(sectionId);
    if (!sectionId) {
      skipped.push({
        ref,
        reason: "timetable row has no ScheduleStudyUnitID to key on",
      });
      continue;
    }

    const dateStr = parseDdMmYyyy(row.Ngay);
    if (!dateStr) {
      skipped.push({ ref, reason: `unparseable Ngay "${row.Ngay ?? ""}"` });
      continue;
    }

    const periodId = row.PeriodID;
    const span = periodsToWallClock(periodId ?? NaN, row.NumberOfPeriods ?? 1);
    if (!span || periodId === null || periodId === undefined) {
      skipped.push({
        ref,
        reason: `no time mapping for periods ${row.PeriodID}+${row.NumberOfPeriods} (periods 5–6 are undocumented)`,
      });
      continue;
    }

    const block = snapToGrid(span.startMin, span.endMin);
    const teacher = orNull(row.FullName);
    // `WeekScheduleID` is optional in the response and only ever used to find a
    // pre-#56 row to rename, so a row missing it simply has no legacy alias —
    // that is not a reason to drop the meeting.
    const meetingId = row.WeekScheduleID;
    const hasMeetingId =
      meetingId !== null && meetingId !== undefined && meetingId !== "";
    items.push({
      externalKey: portalLectureKey({
        scheduleStudyUnitId: sectionId,
        meetingDate: dateStr,
        periodId,
      }),
      legacyExternalKey: hasMeetingId
        ? legacyPortalMeetingKey(meetingId)
        : null,
      title: orNull(row.CurriculumName) ?? sectionId,
      type: "LECTURE",
      scheduledStartTime: minutesToUtc(dateStr, block.startMin, timezone),
      durationMinutes: block.durationMinutes,
      location: orNull(row.RoomID),
      // The one bit of section metadata worth carrying onto the block itself —
      // "who teaches this" is useful at a glance on the calendar.
      note: teacher ? `GV: ${teacher}` : null,
      scheduleStudyUnitId: sectionId,
      // The occurrence-cache coordinates — the same triple the key is built
      // from, kept as fields so the cache never has to re-parse the key.
      meetingDate: dateStr,
      periodId,
      numberOfPeriods: row.NumberOfPeriods ?? 1,
    });

    // The section catalog needs the term coordinates, which are NOT nullable in
    // `PortalSection`; a row missing them still yields a usable meeting.
    const yearStudy = orNull(row.YearStudy);
    const termId = orNull(row.TermID);
    if (yearStudy && termId && !sections.has(sectionId)) {
      const { curriculumId, groupNo } = parseDisplayBlob(row.TKHHienThi);
      sections.set(sectionId, {
        scheduleStudyUnitId: sectionId,
        curriculumId,
        curriculumName: orNull(row.CurriculumName) ?? sectionId,
        yearStudy,
        termId,
        groupNo,
        teacherName: orNull(row.FullName),
        roomId: orNull(row.RoomID),
        buildingName: orNull(row.BuildingName),
        campusName: orNull(row.CampusName),
      });
    }
  }

  return { items, sections: [...sections.values()], skipped };
}

/**
 * Parse a term's exam schedule.
 *
 * `ThoiLuong` is the real sitting length in minutes and is rounded **up** to a
 * multiple of 15 (invariant #3) — a 90-minute exam stays 90, a hypothetical
 * 100-minute one becomes 105 rather than being clipped to 90.
 *
 * The captured response carries a stray empty-string key
 * (`"": "2025-12-01T00:00:00"`) that duplicates the exam date. It is ignored:
 * `NgayThi` + `GioThi` are the documented fields and the only ones that carry
 * the time of day.
 */
export function parseExams(
  rows: readonly PortalExamRow[] | null | undefined,
  timezone: string,
): ParsedExams {
  const items: ParsedPortalItem[] = [];
  const skipped: SkippedItem[] = [];

  for (const row of rows ?? []) {
    const examId = row?.Examination;
    if (examId === null || examId === undefined || examId === "") {
      skipped.push({
        ref: portalExamKey(row?.ScheduleStudyUnitID ?? "unknown"),
        reason: "exam row has no Examination id",
      });
      continue;
    }
    const ref = portalExamKey(examId);

    const dateStr = parseDdMmYyyy(row.NgayThi);
    if (!dateStr) {
      skipped.push({
        ref,
        reason: `unparseable NgayThi "${row.NgayThi ?? ""}"`,
      });
      continue;
    }

    const startMin = parseGioThi(row.GioThi);
    if (startMin === null) {
      skipped.push({ ref, reason: `unparseable GioThi "${row.GioThi ?? ""}"` });
      continue;
    }

    const rawDuration = Number(row.ThoiLuong);
    if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
      skipped.push({
        ref,
        reason: `unusable ThoiLuong "${row.ThoiLuong ?? ""}"`,
      });
      continue;
    }

    // `snapToGrid` does the rounding-up: the end is ceiled onto the grid, so a
    // 90-minute exam stays 90 and a 100-minute one becomes 105.
    const block = snapToGrid(startMin, startMin + rawDuration);
    items.push({
      externalKey: ref,
      title:
        orNull(row.CurriculumName) ??
        orNull(row.ScheduleStudyUnitID) ??
        "Kỳ thi",
      type: "EXAM",
      scheduledStartTime: minutesToUtc(dateStr, block.startMin, timezone),
      durationMinutes: block.durationMinutes,
      location: orNull(row.PhongThi) ?? orNull(row.DiaDiem),
      // The exam format (`HinhThucThi`) is deliberately dropped — an ingested
      // fixed session carries only its room, in `location`, and no note.
      note: null,
      scheduleStudyUnitId: orNull(row.ScheduleStudyUnitID),
    });
  }

  return { items, skipped };
}
