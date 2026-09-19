import { Prisma } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Row-locked read of one user's `preferenceMatrix` (+ `preferenceMatrixDecayedAt`)
 * inside a transaction, via `SELECT ... FOR UPDATE` (Item 3B3 concurrency
 * note) — guards the read-modify-write BOTH `MatrixDecayService`'s nightly
 * cron and per-event reinforcement (`SchedulingFeedbackService.
 * reinforcePreferenceMatrix`) perform against the SAME whole-array column, so
 * one job's write can never silently clobber the other's concurrent update
 * (a lost-update race — Postgres's default Read Committed isolation doesn't
 * protect a bare read-then-write against this on its own).
 *
 * `fn` runs inside the same transaction and must perform the write itself
 * (via the given `tx`) before returning — the row lock is held for the
 * transaction's whole lifetime. Returns `null` (without calling `fn`) when
 * the user row doesn't exist.
 */
export async function withLockedPreferenceMatrix<T>(
  prisma: PrismaService,
  userId: string,
  fn: (
    row: { preferenceMatrix: number[]; preferenceMatrixDecayedAt: Date | null },
    tx: Prisma.TransactionClient,
  ) => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { preferenceMatrix: number[]; preferenceMatrixDecayedAt: Date | null }[]
    >`
      SELECT "preferenceMatrix", "preferenceMatrixDecayedAt"
      FROM "User"
      WHERE id = ${userId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return null;
    return fn(row, tx);
  });
}
