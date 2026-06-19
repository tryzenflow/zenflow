import { PrismaClient } from "../../../generated/prisma";

/** Quick row-count + quality snapshot of the sim DB (for smoke/quality checks). */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const [users, tasks, events, tags] = await Promise.all([
      prisma.user.count(),
      prisma.task.count(),
      prisma.taskEvent.count(),
      prisma.tag.count(),
    ]);
    const byStatus = await prisma.task.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const byEvent = await prisma.taskEvent.groupBy({
      by: ["eventType"],
      _count: { _all: true },
    });
    const now = new Date();
    const overdue = await prisma.task.count({
      where: { status: "PENDING", deadline: { not: null, lt: now } },
    });
    const withDeadline = await prisma.task.count({
      where: { deadline: { not: null } },
    });

    // Timezones in use (should NOT be UTC-only).
    const tz = await prisma.user.groupBy({
      by: ["timezone"],
      _count: { _all: true },
    });

    // Night-owl wrap check: users whose workStart > workEnd, and a sample of
    // where their tasks actually land (local hour-of-day).
    const owls = await prisma.user.findMany({
      where: { workStart: { gt: prisma.user.fields.workEnd } },
      select: { id: true, timezone: true, workStart: true, workEnd: true },
    });

    // Tags-per-task distribution (the 0–10 gaussian).
    const links = await prisma.$queryRawUnsafe<{ n: number; c: bigint }[]>(
      `SELECT n, count(*)::bigint AS c FROM (
         SELECT t.id, count(j."A")::int AS n
         FROM "Task" t LEFT JOIN "_TagToTask" j ON j."B" = t.id
         GROUP BY t.id
       ) s GROUP BY n ORDER BY n`,
    );

    // Max conflict-stack DEPTH: most tasks overlapping a single instant per user.
    // (Sampled over placed tasks; the requirement is ~2–3, not 4–5.)
    const depth = await prisma.$queryRawUnsafe<{ maxdepth: number }[]>(
      `WITH placed AS (
         SELECT id, "userId", "scheduledStartTime" AS s,
                "scheduledStartTime" + ("durationMinutes" || ' minutes')::interval AS e
         FROM "Task" WHERE "scheduledStartTime" IS NOT NULL AND status='PENDING'
       )
       SELECT COALESCE(max(d),0)::int AS maxdepth FROM (
         SELECT a.id, count(*)::int AS d
         FROM placed a JOIN placed b
           ON a."userId" = b."userId" AND a.s < b.e AND b.s < a.e
         GROUP BY a.id
       ) x`,
    );

    // Distribution of conflict-stack depth (how many tasks an overlapping task
    // shares its instant with). Typical should be 2–3; deeper is a rare tail.
    const depthHist = await prisma.$queryRawUnsafe<{ d: number; c: bigint }[]>(
      `WITH placed AS (
         SELECT id, "userId", "scheduledStartTime" AS s,
                "scheduledStartTime" + ("durationMinutes" || ' minutes')::interval AS e
         FROM "Task" WHERE "scheduledStartTime" IS NOT NULL AND status='PENDING'
       ), depths AS (
         SELECT a.id, count(*)::int AS d
         FROM placed a JOIN placed b
           ON a."userId" = b."userId" AND a.s < b.e AND b.s < a.e
         GROUP BY a.id
       )
       SELECT d, count(*)::bigint AS c FROM depths GROUP BY d ORDER BY d`,
    );

    // Creation-before-adjustment: any task whose first MOVE/RESIZE predates CREATE?
    const ordering = await prisma.$queryRawUnsafe<{ violations: bigint }[]>(
      `SELECT count(*)::bigint AS violations FROM (
         SELECT "taskId",
                min("occurredAt") FILTER (WHERE "eventType"='CREATE') AS created,
                min("occurredAt") FILTER (WHERE "eventType" IN ('MOVE','RESIZE')) AS firstadj
         FROM "TaskEvent" GROUP BY "taskId"
       ) s WHERE firstadj IS NOT NULL AND created IS NOT NULL AND firstadj < created`,
    );

    console.log(
      JSON.stringify(
        {
          users,
          tasks,
          tags,
          events,
          tagLinks: links.reduce((a, r) => a + Number(r.c) * r.n, 0),
          overduePending: overdue,
          pendingOrTasksWithDeadline: withDeadline,
          byStatus: Object.fromEntries(
            byStatus.map((r) => [r.status, r._count._all]),
          ),
          byEvent: Object.fromEntries(
            byEvent.map((r) => [r.eventType, r._count._all]),
          ),
          timezones: Object.fromEntries(
            tz.map((r) => [r.timezone, r._count._all]),
          ),
          nightOwls: owls.map((o) => ({
            tz: o.timezone,
            workStart: o.workStart,
            workEnd: o.workEnd,
          })),
          tagsPerTask: Object.fromEntries(links.map((r) => [r.n, Number(r.c)])),
          maxConflictDepth: depth[0]?.maxdepth ?? 0,
          conflictDepthHistogram: Object.fromEntries(
            depthHist.map((r) => [r.d, Number(r.c)]),
          ),
          createAfterAdjustViolations: Number(ordering[0]?.violations ?? 0),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
