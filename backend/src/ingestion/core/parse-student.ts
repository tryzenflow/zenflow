/**
 * Pure parsing of the portal's student endpoints (`info`, `getstudyprogram`,
 * `marks`) into the fields Zenflow stores.
 *
 * The marks payload repeats the student's phone, birthday and birthplace on
 * every course row. Nothing here reads those fields, so they cannot leak into
 * storage.
 */

export interface PortalStudentInfo {
  sinhVien?: {
    HoTen?: string | null;
    GioiTinh?: string | null;
    KhoaHoc?: string | null;
    LopSinhVien?: string | null;
  };
}

export interface PortalStudyProgramRow {
  StudentID: string;
  StudyProgramID: string;
  StudyProgramName: string;
  Type: number;
}

/** The marks row fields we read; every other field is ignored. */
export interface PortalMarkRow {
  StudentID?: string | null;
  ScheduleStudyUnitID?: string | null;
  YearStudy?: string | null;
  TermID?: string | null;
  CurriculumID?: string | null;
  CurriculumName?: string | null;
  Credits?: string | null;
  DiemTK_10?: string | null;
  DiemTK_4?: string | null;
  DiemTK_Chu?: string | null;
  IsPass?: string | null;
  Note?: string | null;
  OlogyName?: string | null;
  ChuyenNganh?: string | null;
  TenXepLoai?: string | null;
  TB_HK_4?: string | null;
  TB_HK_10?: string | null;
  Dat_HK?: string | null;
  TB_TL_HK_4?: string | null;
  TB_TL_HK_10?: string | null;
  Dat_TL_HK?: string | null;
  TB_TL_TN?: string | null;
  T_TC_TL_TN?: string | null;
  DiemRenLuyenHK?: string | null;
}

export interface PortalMarksYear {
  NamHoc?: string;
  DanhSachDiem?: {
    HocKy?: string;
    DanhSachDiemHK?: PortalMarkRow[];
  }[];
}

export interface ParsedProfile {
  fullName: string;
  gender: string | null;
  cohort: string | null;
  className: string | null;
}

export interface ParsedMark {
  scheduleStudyUnitId: string;
  yearStudy: string;
  termId: string;
  curriculumId: string | null;
  curriculumName: string;
  credits: number;
  score10: number | null;
  score4: number | null;
  letter: string | null;
  passed: boolean | null;
  note: string | null;
}

export interface ParsedTermResult {
  yearStudy: string;
  termId: string;
  gpa4: number | null;
  gpa10: number | null;
  creditsEarned: number | null;
  cumulativeGpa4: number | null;
  cumulativeGpa10: number | null;
  cumulativeCredits: number | null;
  conductScore: number | null;
}

export interface ParsedMarks {
  marks: ParsedMark[];
  terms: ParsedTermResult[];
  studentId: string | null;
  faculty: string | null;
  major: string | null;
  ranking: string | null;
  /** Cumulative figures from the newest term that has them. */
  gpa4: number | null;
  gpa10: number | null;
  creditsEarned: number | null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function num(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStudentInfo(
  info: PortalStudentInfo,
): ParsedProfile | null {
  const sv = info.sinhVien;
  const fullName = text(sv?.HoTen);
  if (!fullName) return null;
  return {
    fullName,
    gender: text(sv?.GioiTinh),
    cohort: text(sv?.KhoaHoc),
    className: text(sv?.LopSinhVien),
  };
}

export function parseMarks(years: readonly PortalMarksYear[]): ParsedMarks {
  const marks: ParsedMark[] = [];
  const terms = new Map<string, ParsedTermResult>();
  const out: ParsedMarks = {
    marks,
    terms: [],
    studentId: null,
    faculty: null,
    major: null,
    ranking: null,
    gpa4: null,
    gpa10: null,
    creditsEarned: null,
  };

  for (const year of years) {
    for (const term of year.DanhSachDiem ?? []) {
      for (const row of term.DanhSachDiemHK ?? []) {
        const unit = text(row.ScheduleStudyUnitID);
        const yearStudy = text(row.YearStudy) ?? text(year.NamHoc);
        const termId = text(row.TermID) ?? text(term.HocKy);
        if (!unit || !yearStudy || !termId) continue;

        out.studentId ??= text(row.StudentID);
        out.faculty = text(row.OlogyName) ?? out.faculty;
        out.major = text(row.ChuyenNganh) ?? out.major;

        const pass = text(row.IsPass);
        marks.push({
          scheduleStudyUnitId: unit,
          yearStudy,
          termId,
          curriculumId: text(row.CurriculumID),
          curriculumName: text(row.CurriculumName) ?? unit,
          credits: num(row.Credits) ?? 0,
          score10: num(row.DiemTK_10),
          score4: num(row.DiemTK_4),
          letter: text(row.DiemTK_Chu),
          passed: pass === null ? null : pass.toLowerCase() === "x",
          note: text(row.Note),
        });

        // Aggregates repeat on every row of a term; the last row wins.
        const cumulativeGpa4 = num(row.TB_TL_TN);
        terms.set(`${yearStudy}|${termId}`, {
          yearStudy,
          termId,
          gpa4: num(row.TB_HK_4),
          gpa10: num(row.TB_HK_10),
          creditsEarned: num(row.Dat_HK),
          cumulativeGpa4: cumulativeGpa4 ?? num(row.TB_TL_HK_4),
          cumulativeGpa10: num(row.TB_TL_HK_10),
          cumulativeCredits: num(row.T_TC_TL_TN) ?? num(row.Dat_TL_HK),
          conductScore: num(row.DiemRenLuyenHK),
        });

        // Rows are chronological, so the last non-empty values are the latest.
        out.ranking = text(row.TenXepLoai) ?? out.ranking;
        out.gpa4 = cumulativeGpa4 ?? out.gpa4;
        out.gpa10 = num(row.TB_TL_HK_10) ?? out.gpa10;
        out.creditsEarned = num(row.T_TC_TL_TN) ?? out.creditsEarned;
      }
    }
  }
  out.terms = [...terms.values()];
  return out;
}
