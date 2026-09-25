import type { PrismaService } from "../prisma/prisma.service";

/**
 * A `TASK` row is inserted first and placed right after, outside the insert's
 * transaction. If that placement throws, the rows this request just inserted
 * would stay behind unplaced (`scheduledStartTime = null`), which is corrupt.
 * Run `place`; on failure hard-delete those rows (and their CREATE events, and
 * the `SessionSeries` when this request created it) before rethrowing.
 */
export async function placeOrDiscard<T>(
  prisma: PrismaService,
  created: { userId: string; sessionIds: string[]; seriesId?: string },
  place: () => Promise<T>,
): Promise<T> {
  try {
    return await place();
  } catch (err) {
    const { userId, sessionIds, seriesId } = created;
    await prisma.$transaction([
      prisma.sessionEvent.deleteMany({
        where: { userId, sessionId: { in: sessionIds } },
      }),
      prisma.session.deleteMany({
        where: { userId, id: { in: sessionIds } },
      }),
      ...(seriesId
        ? [
            prisma.sessionSeries.deleteMany({
              where: { userId, id: seriesId },
            }),
          ]
        : []),
    ]);
    throw err;
  }
}
