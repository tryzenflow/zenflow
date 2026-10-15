/** DLU student profile and marks, as returned by `GET /users/me/student` and `/users/me/marks`. */

export interface StudentProfileDto {
  fullName: string;
  gender: string | null;
  cohort: string | null;
  className: string | null;
  faculty: string | null;
  major: string | null;
  studentId: string | null;
  studyProgramName: string | null;
  /** Cumulative GPA on the 4 point scale. */
  gpa4: number | null;
  gpa10: number | null;
  creditsEarned: number | null;
  ranking: string | null;
  /** ISO instant; null until marks have been fetched. */
  marksFetchedAt: string | null;
}

export interface StudentTermResultDto {
  yearStudy: string;
  termId: string;
  gpa4: number | null;
  gpa10: number | null;
  creditsEarned: number | null;
  conductScore: number | null;
}

export interface StudentMarkDto {
  curriculumId: string | null;
  curriculumName: string;
  credits: number;
  score10: number | null;
  score4: number | null;
  letter: string | null;
  passed: boolean | null;
  /** Compulsory but not counted towards the course credits (the portal's red *). */
  noCredit: boolean;
}

export interface StudentTermMarksDto extends StudentTermResultDto {
  marks: StudentMarkDto[];
}

export interface StudentResponse {
  /** Null until the first profile fetch lands. */
  profile: StudentProfileDto | null;
}

export interface StudentMarksResponse {
  terms: StudentTermMarksDto[];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Portal names can carry `<span style="color:red">*</span>`: strip the markup and report the star. */
export function parseCurriculumName(raw: string): {
  name: string;
  noCredit: boolean;
} {
  const plain = raw
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
  const noCredit = plain.includes("*");
  const name = plain.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  return { name: name || plain.trim(), noCredit };
}
