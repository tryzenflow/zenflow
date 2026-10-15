import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import {
  PORTAL_MARKS_QUEUE,
  type MarksJobData,
  type ProfileJobData,
} from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";
import type { PortalMarksYear } from "./core/parse-student";
import { parseMarks, parseStudentInfo } from "./core/parse-student";
import { PortalSessionService } from "./portal-session.service";
import { errorMessage, sleep } from "./watcher-support";

/** Marks are refreshed at most this often by the watcher. */
export const MARKS_REFRESH_MS = 24 * 60 * 60_000;

export interface StudentSyncResult {
  ok: boolean;
}

/**
 * Student profile and marks: the bodies of the `portal-profile` and
 * `portal-marks` jobs.
 *
 * Only normalised fields are stored. The marks payload repeats the student's
 * phone and birthday on every course row, so no raw body is kept anywhere.
 */
@Injectable()
export class StudentSyncService {
  private readonly logger = new Logger(StudentSyncService.name);
  private readonly requestDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portal: PortalAPIService,
    private readonly session: PortalSessionService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
  ) {
    this.requestDelayMs = Number(
      this.config.get("INGESTION_REQUEST_DELAY_MS") ?? 750,
    );
  }

  /** Fetch name, class, cohort and study programs; then queue the marks job. */
  async syncProfile(
    data: ProfileJobData,
    now = new Date(),
  ): Promise<StudentSyncResult> {
    const token = await this.session.token(data.userId);
    if (!token) return { ok: false };

    const info = parseStudentInfo(await this.portal.fetchStudentInfo(token));
    if (!info) throw new Error("The portal returned no student profile");
    await sleep(this.requestDelayMs);
    const programs = await this.portal.fetchStudyPrograms(token);

    // Type 1 is the student's main program.
    const main = programs.find((p) => p.Type === 1) ?? programs[0];
    const fields = {
      integrationId: data.integrationId,
      ...info,
      studentId: main?.StudentID ?? null,
      studyProgramId: main?.StudyProgramID ?? null,
      studyProgramName: main?.StudyProgramName ?? null,
      profileFetchedAt: now,
    };
    await this.prisma.studentProfile.upsert({
      where: { userId: data.userId },
      create: { userId: data.userId, ...fields },
      update: fields,
    });
    for (const program of programs) {
      await this.prisma.studyProgram.upsert({
        where: {
          userId_studyProgramId: {
            userId: data.userId,
            studyProgramId: program.StudyProgramID,
          },
        },
        create: {
          userId: data.userId,
          studyProgramId: program.StudyProgramID,
          name: program.StudyProgramName,
          type: program.Type,
        },
        update: { name: program.StudyProgramName, type: program.Type },
      });
    }

    if (programs.length > 0) {
      await this.queue.enqueueBestEffort(
        PORTAL_MARKS_QUEUE,
        { userId: data.userId, integrationId: data.integrationId },
        { jobId: idempotencyKey("marks", data.integrationId, now.getTime()) },
      );
    }
    return { ok: true };
  }

  /** Fetch marks for each study program and attach them to the student. */
  async syncMarks(
    data: MarksJobData,
    now = new Date(),
  ): Promise<StudentSyncResult> {
    const programs = await this.prisma.studyProgram.findMany({
      where: { userId: data.userId },
      select: { studyProgramId: true },
    });
    if (programs.length === 0) return { ok: true };

    const token = await this.session.token(data.userId);
    if (!token) return { ok: false };

    const years: PortalMarksYear[] = [];
    let first = true;
    for (const { studyProgramId } of programs) {
      if (!first) await sleep(this.requestDelayMs);
      first = false;
      years.push(...(await this.portal.fetchMarks(token, studyProgramId)));
    }
    const parsed = parseMarks(years);

    for (const mark of parsed.marks) {
      await this.prisma.studentMark.upsert({
        where: {
          userId_scheduleStudyUnitId: {
            userId: data.userId,
            scheduleStudyUnitId: mark.scheduleStudyUnitId,
          },
        },
        create: { userId: data.userId, ...mark },
        update: mark,
      });
    }
    for (const term of parsed.terms) {
      await this.prisma.studentTermResult.upsert({
        where: {
          userId_yearStudy_termId: {
            userId: data.userId,
            yearStudy: term.yearStudy,
            termId: term.termId,
          },
        },
        create: { userId: data.userId, ...term },
        update: term,
      });
    }

    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: data.userId },
      select: { marksFetchedAt: true },
    });
    await this.prisma.studentProfile.updateMany({
      where: { userId: data.userId },
      data: {
        marksFetchedAt: now,
        studentId: parsed.studentId ?? undefined,
        faculty: parsed.faculty ?? undefined,
        major: parsed.major ?? undefined,
        ranking: parsed.ranking,
        gpa4: parsed.gpa4,
        gpa10: parsed.gpa10,
        creditsEarned: parsed.creditsEarned,
      },
    });

    // Announce once, the first time marks land.
    if (profile && profile.marksFetchedAt === null) {
      await this.announce(data.userId);
    }
    return { ok: true };
  }

  private async announce(userId: string): Promise<void> {
    try {
      const row = await this.notifications.create(userId, {
        sessionId: null,
        title: "Your marks are available",
        content: "Open your profile.",
        eventEndsAt: null,
        materializeSession: false,
        eventName: "marks.ready",
      });
      this.notifications.notify(NotificationEvent.NEW_SESSION, row);
    } catch (error) {
      this.logger.warn(`Could not raise marks.ready: ${errorMessage(error)}`);
    }
  }

  /** Students whose profile is missing, or whose marks are older than the refresh period. */
  async dueForMarks(now: Date, limit: number): Promise<MarksJobData[]> {
    const cutoff = new Date(now.getTime() - MARKS_REFRESH_MS);
    const rows = await this.prisma.studentProfile.findMany({
      where: {
        OR: [{ marksFetchedAt: null }, { marksFetchedAt: { lt: cutoff } }],
      },
      orderBy: [{ marksFetchedAt: { sort: "asc", nulls: "first" } }],
      take: limit,
      select: { userId: true, integrationId: true },
    });
    return rows;
  }
}
