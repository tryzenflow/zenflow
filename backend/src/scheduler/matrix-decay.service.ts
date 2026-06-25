import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { decayMatrix, MATRIX_HALF_LIFE_DAYS } from "./matrix-decay";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Tasks processed per transaction so one run never opens an unbounded tx. */
const DECAY_BATCH_SIZE = 200;

/**
 * Daily exponential time-decay of every user's signed 7×24 preference matrix.
 *
 * This is the I/O wrapper — the ONLY layer that touches Prisma — around the PURE
 * {@link decayMatrix} helper (`matrix-decay.ts`, owned + unit-tested by the
 * ml-engineer). For each user it loads `preferenceMatrix` +
 * `preferenceMatrixDecayedAt`, computes Δdays since the last decay, calls the
 * pure helper (`cell *= 2^(−Δdays / MATRIX_HALF_LIFE_DAYS)`), and writes the
 * decayed matrix back, stamping `preferenceMatrixDecayedAt = now`. Stale
 * preferences fade with a ~3-week half-life without hard cutoffs.
 *
 * Skips rows that have no full elapsed day or no matrix yet (just stamps the
 * time on first sight), so re-running the cron within a day is a no-op.
 */
@Injectable()
export class MatrixDecayService {
  private readonly logger = new Logger(MatrixDecayService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily sweep at ~03:00 server time. `now` is injectable for tests. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    const count = await this.decayAll();
    if (count > 0) {
      this.logger.log(`Decayed ${count} preference matrix(es)`);
    }
  }

  /**
   * Apply one decay step to every user's matrix. Returns the number of matrices
   * actually decayed (rows that had a non-empty matrix and ≥1 elapsed day). A
   * row seen for the first time (`preferenceMatrixDecayedAt` null) is only
   * stamped — there is no prior instant to measure Δdays from.
   */
  async decayAll(now = new Date()): Promise<number> {
    let processed = 0;
    let cursor: string | undefined;

    for (;;) {
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          preferenceMatrix: true,
          preferenceMatrixDecayedAt: true,
        },
        orderBy: { id: "asc" },
        take: DECAY_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      for (const u of users) {
        const last = u.preferenceMatrixDecayedAt;
        const hasMatrix =
          u.preferenceMatrix.length === PREFERENCE_MATRIX_LENGTH;

        // First sight or empty matrix: stamp the time, nothing to decay.
        if (!last || !hasMatrix) {
          await this.prisma.user.update({
            where: { id: u.id },
            data: { preferenceMatrixDecayedAt: now },
          });
          continue;
        }

        const deltaDays = (now.getTime() - last.getTime()) / MS_PER_DAY;
        if (deltaDays <= 0) continue; // already decayed today

        const decayed = decayMatrix(
          u.preferenceMatrix,
          deltaDays,
          MATRIX_HALF_LIFE_DAYS,
        );
        await this.prisma.user.update({
          where: { id: u.id },
          data: {
            preferenceMatrix: decayed,
            preferenceMatrixDecayedAt: now,
          },
        });
        processed += 1;
      }

      if (users.length < DECAY_BATCH_SIZE) break;
    }

    return processed;
  }
}
