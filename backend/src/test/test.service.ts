import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { SeedTaskInput } from "@zenflow/shared";

@Injectable()
export class TestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Truncates all test data tables in FK-safe order.
   * This is destructive and only available in test environment.
   */
  async resetDatabase(): Promise<void> {
    // Order matters due to foreign keys:
    // 1. Child tables with FKs to Session
    await this.prisma.sessionEvent.deleteMany();
    await this.prisma.slotProposal.deleteMany();
    await this.prisma.sessionReminder.deleteMany();
    await this.prisma.notification.deleteMany();
    await this.prisma.file.deleteMany();

    // 2. Session and SessionSeries (Session has FK to SessionSeries)
    await this.prisma.session.deleteMany();
    await this.prisma.sessionSeries.deleteMany();

    // 3. Tag (has FK to User; implicit m2m join with Session cleaned above)
    await this.prisma.tag.deleteMany();

    // 4. User-owned child tables
    await this.prisma.banditArmState.deleteMany();
    await this.prisma.userEncryptionKey.deleteMany();
    await this.prisma.integration.deleteMany();
    await this.prisma.userDevice.deleteMany();

    // 5. Users (cascades to remaining relations via onDelete: Cascade)
    await this.prisma.user.deleteMany();

    // OTP keys in Redis have short TTLs and expire naturally — no explicit
    // cache cleanup needed for test isolation.
  }

  /**
   * Seeds a test task (Session) for the given user.
   * Requires authenticated user context.
   *
   * `scheduledStartTime` is always written so Maestro flows can place seeded
   * tasks on deterministic calendar days without going through the placement
   * engine (which would choose its own slot), and because a live session row
   * must never have a null start (the DTO rejects a seed without one).
   */
  async seedTask(userId: string, input: SeedTaskInput) {
    const {
      title,
      type,
      deadline,
      durationMinutes,
      sessionCount = 1,
      scheduledStartTime,
    } = input;
    const scheduled = new Date(scheduledStartTime);

    if (sessionCount > 1) {
      // Create a series with multiple sessions
      const series = await this.prisma.sessionSeries.create({
        data: {
          userId,
          type,
          deadline: new Date(deadline),
        },
      });

      const sessions = await Promise.all(
        Array.from({ length: sessionCount }, (_, i) =>
          this.prisma.session.create({
            data: {
              userId,
              seriesId: series.id,
              title: `${title} (${i + 1}/${sessionCount})`,
              durationMinutes,
              type,
              source: "USER",
              deadline: new Date(deadline),
              scheduledStartTime: scheduled,
            },
          }),
        ),
      );

      return { series, sessions };
    }

    // Single session
    const session = await this.prisma.session.create({
      data: {
        userId,
        title,
        durationMinutes,
        type,
        source: "USER",
        deadline: new Date(deadline),
        scheduledStartTime: scheduled,
      },
    });

    return { session };
  }
}
