import { Injectable } from "@nestjs/common";
import type { Streak } from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { computeStreak, dayKey } from "./core/streak";

/**
 * Per-user daily streak. Recomputed from the days a TASK session or
 * occurrence was completed (classes, exams and do-not-disturb never count) on each read or check-off, so undo and day rollover
 * need no bookkeeping; the result is persisted to `UserStreak`.
 */
@Injectable()
export class StreaksService {
  constructor(private readonly prisma: PrismaService) {}

  async refresh(user: User, now: Date = new Date()): Promise<Streak> {
    const tz = user.timezone;
    const [sessions, occurrences] = await Promise.all([
      this.prisma.session.findMany({
        where: {
          userId: user.id,
          deleted: false,
          type: "TASK",
          completedAt: { not: null },
        },
        select: { completedAt: true },
      }),
      this.prisma.sessionOccurrenceState.findMany({
        where: {
          userId: user.id,
          completedAt: { not: null },
          series: { type: "TASK" },
        },
        select: { completedAt: true },
      }),
    ]);
    const days = [...sessions, ...occurrences].map((r) =>
      dayKey(r.completedAt as Date, tz),
    );
    const streak = computeStreak(days, dayKey(now, tz));

    const stored = {
      current: streak.current,
      longest: streak.longest,
      freezesAvailable: streak.freezesAvailable,
      frozenDays: streak.frozenDays,
      lastActiveDay: streak.lastActiveDay,
    };
    await this.prisma.userStreak.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...stored },
      update: stored,
    });
    return streak;
  }
}
