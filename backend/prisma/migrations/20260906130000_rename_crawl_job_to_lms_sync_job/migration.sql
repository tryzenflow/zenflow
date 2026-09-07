-- The LMS watcher reads Moodle's JSON calendar API; it does not crawl pages.
-- Rename the job tables to match, preserving rows (RENAME, not drop/recreate).
ALTER TABLE "CrawlJob" RENAME TO "LmsSyncJob";
ALTER TABLE "CrawlJobItem" RENAME TO "LmsSyncJobItem";
ALTER TABLE "LmsSyncJobItem" RENAME COLUMN "crawlJobId" TO "lmsSyncJobId";

-- Postgres carries indexes and constraints across a table rename but keeps
-- their old names; rename them too so a later `prisma migrate diff` is a no-op.
ALTER INDEX "CrawlJob_pkey" RENAME TO "LmsSyncJob_pkey";
ALTER INDEX "CrawlJobItem_pkey" RENAME TO "LmsSyncJobItem_pkey";
ALTER INDEX "CrawlJobItem_crawlJobId_idx" RENAME TO "LmsSyncJobItem_lmsSyncJobId_idx";
ALTER TABLE "LmsSyncJob" RENAME CONSTRAINT "CrawlJob_integrationId_fkey" TO "LmsSyncJob_integrationId_fkey";
ALTER TABLE "LmsSyncJobItem" RENAME CONSTRAINT "CrawlJobItem_crawlJobId_fkey" TO "LmsSyncJobItem_lmsSyncJobId_fkey";

-- Retire the crawl-era global dedupe table: never written by any code, and
-- superseded by the `Session.externalKey` unique constraint.
DROP TABLE "CrawledUrl";
