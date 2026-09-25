/**
 * One-off repair: give every live `TASK` whose `scheduledStartTime` is `null`
 * a start. Such rows are corrupt — placement never leaves a TASK unplaced any
 * more (last resort: least-conflict slot before the deadline, else the first
 * free slot up to 30 days late, else pinned by the deadline) — but rows written
 * before that guarantee may still exist.
 *
 *   pnpm --filter backend backfill:unplaced            # place them
 *   pnpm --filter backend backfill:unplaced --dry-run  # only count them
 *
 * Boots the app context against `.env.dev` (point it elsewhere with
 * `dotenv -e <file>`), so placement goes through the same Python service /
 * frozen fallback as the API. A standalone task is placed like a deadline
 * edit; a series places only its unplaced sittings, around the placed ones.
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { TaskPlacementService } from "../src/scheduler/io/task-placement.service";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const prisma = app.get(PrismaService);
    const placement = app.get(TaskPlacementService);

    const rows = await prisma.session.findMany({
      where: { type: "TASK", deleted: false, scheduledStartTime: null },
      select: {
        id: true,
        userId: true,
        seriesId: true,
        durationMinutes: true,
        deadline: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const bySeries = new Map<string, typeof rows>();
    const singles: typeof rows = [];
    for (const r of rows) {
      if (!r.seriesId) singles.push(r);
      else bySeries.set(r.seriesId, [...(bySeries.get(r.seriesId) ?? []), r]);
    }
    console.log(
      `${rows.length} unplaced TASK row(s): ${singles.length} standalone, ` +
        `${rows.length - singles.length} in ${bySeries.size} series`,
    );
    if (dryRun || rows.length === 0) return;

    const users = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        })
      ).map((u) => [u.id, u]),
    );
    const now = new Date();
    let placed = 0;
    let failed = 0;

    for (const r of singles) {
      try {
        const res = await placement.placeOnDeadlineChange({
          user: users.get(r.userId)!,
          task: {
            id: r.id,
            durationMinutes: r.durationMinutes,
            deadline: r.deadline ?? now,
          },
          now,
        });
        console.log(
          `task ${r.id} -> ${res.scheduledStartTime?.toISOString()}${
            res.lastResort ? " (last resort)" : ""
          }`,
        );
        placed++;
      } catch (err) {
        console.error(`task ${r.id} failed:`, err);
        failed++;
      }
    }

    for (const [seriesId, members] of bySeries) {
      try {
        const res = await placement.placeSeriesOnCreate({
          user: users.get(members[0].userId)!,
          seriesId,
          members: members.map((m) => ({
            id: m.id,
            durationMinutes: m.durationMinutes,
          })),
          deadline: members[0].deadline ?? now,
          now,
        });
        for (const p of res) {
          console.log(
            `series ${seriesId} sitting ${p.id} -> ${p.scheduledStartTime?.toISOString()}${
              p.lastResort ? " (last resort)" : ""
            }`,
          );
        }
        placed += members.length;
      } catch (err) {
        console.error(`series ${seriesId} failed:`, err);
        failed += members.length;
      }
    }

    console.log(`done: ${placed} placed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
