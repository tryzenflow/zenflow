/**
 * One-off repair: link LMS-ingested sessions to their Moodle course.
 *
 * `Session.lmsCourseId` is set on create only, so rows ingested before the
 * column existed keep it null. Their course colour (`courseKey`) and the
 * occurrence fan-out miss them until the item changes upstream. The course
 * comes from `LmsCourseOccurrence`, which shares the session's `externalKey`.
 *
 *   pnpm --filter backend backfill:lms-course            # link them
 *   pnpm --filter backend backfill:lms-course --dry-run  # only count them
 *
 * Idempotent: only rows with a null `lmsCourseId` are written. Connects to
 * `.env.dev` by default (point elsewhere with `dotenv -e <file>`). Raw SQL, so
 * `updatedAt` is left as it is.
 */
import { PrismaClient } from "../generated/prisma/client";
import { databaseUrl } from "../src/common/config/connections";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient({
    datasourceUrl: databaseUrl((key) => process.env[key]),
  });
  try {
    const [{ linkable }] = await prisma.$queryRaw<{ linkable: bigint }[]>`
      SELECT count(*) AS linkable
      FROM "Session" s
      JOIN "LmsCourseOccurrence" o ON o."externalKey" = s."externalKey"
      WHERE s."source" = 'LMS' AND s."lmsCourseId" IS NULL`;
    console.log(`${linkable} LMS session(s) can be linked to a course`);

    if (!dryRun && linkable > 0n) {
      const linked = await prisma.$executeRaw`
        UPDATE "Session" s
        SET "lmsCourseId" = o."lmsCourseId"
        FROM "LmsCourseOccurrence" o
        WHERE o."externalKey" = s."externalKey"
          AND s."source" = 'LMS'
          AND s."lmsCourseId" IS NULL`;
      console.log(`linked ${linked} session(s)`);
    }

    const [{ unlinked }] = await prisma.$queryRaw<{ unlinked: bigint }[]>`
      SELECT count(*) AS unlinked
      FROM "Session"
      WHERE "source" = 'LMS' AND "lmsCourseId" IS NULL`;
    console.log(
      `${unlinked} LMS session(s) still without a course (no occurrence row)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
