import { Injectable } from "@nestjs/common";
import {
  parseCurriculumName,
  type StudentMarksResponse,
  type StudentResponse,
} from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class StudentService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(userId: string): Promise<StudentResponse> {
    const row = await this.prisma.studentProfile.findUnique({
      where: { userId },
    });
    if (!row) return { profile: null };
    return {
      profile: {
        fullName: row.fullName,
        gender: row.gender,
        cohort: row.cohort,
        className: row.className,
        faculty: row.faculty,
        major: row.major,
        studentId: row.studentId,
        studyProgramName: row.studyProgramName,
        gpa4: row.gpa4,
        gpa10: row.gpa10,
        creditsEarned: row.creditsEarned,
        ranking: row.ranking,
        marksFetchedAt: row.marksFetchedAt?.toISOString() ?? null,
      },
    };
  }

  /** Marks grouped by term, newest first. */
  async marks(userId: string): Promise<StudentMarksResponse> {
    const [marks, results] = await Promise.all([
      this.prisma.studentMark.findMany({
        where: { userId },
        orderBy: [{ curriculumName: "asc" }],
      }),
      this.prisma.studentTermResult.findMany({ where: { userId } }),
    ]);
    const terms = results.map((r) => ({
      yearStudy: r.yearStudy,
      termId: r.termId,
      gpa4: r.gpa4,
      gpa10: r.gpa10,
      creditsEarned: r.creditsEarned,
      conductScore: r.conductScore,
      marks: marks
        .filter((m) => m.yearStudy === r.yearStudy && m.termId === r.termId)
        .map((m) => {
          const { name, noCredit } = parseCurriculumName(m.curriculumName);
          return {
            curriculumId: m.curriculumId,
            curriculumName: name,
            noCredit,
            credits: m.credits,
            score10: m.score10,
            score4: m.score4,
            letter: m.letter,
            passed: m.passed,
          };
        }),
    }));
    terms.sort((a, b) =>
      `${b.yearStudy}${b.termId}`.localeCompare(`${a.yearStudy}${a.termId}`),
    );
    return { terms };
  }
}
