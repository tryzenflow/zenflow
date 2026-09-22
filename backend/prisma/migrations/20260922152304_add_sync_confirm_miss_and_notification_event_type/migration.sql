/*
  Warnings:

  - Added the required column `eventName` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `eventType` to the `Notification` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('CREATED', 'UPDATED', 'REMOVED', 'CONFLICT');

-- AlterTable: add nullable first so pre-existing rows can be backfilled, then
-- tighten to NOT NULL — every row that predates this migration is dev/seed
-- data (issue #60/#62), so a best-effort classification from its title/topic
-- is fine; nothing production-facing depends on its exact value.
ALTER TABLE "Notification" ADD COLUMN     "eventName" TEXT,
ADD COLUMN     "eventType" "NotificationEventType";

UPDATE "Notification"
SET
  "eventType" = CASE
    WHEN "topic" IN ('ASSIGNMENT_CONFLICT', 'EXAM_CONFLICT', 'TIMETABLE_CONFLICT') THEN 'CONFLICT'
    WHEN "title" LIKE 'Removed from DLU:%' OR "title" LIKE '%removed%' OR "title" LIKE '%changed%' THEN 'REMOVED'
    WHEN "title" LIKE 'Updated:%' OR "title" LIKE '%is available' THEN 'UPDATED'
    ELSE 'CREATED'
  END::"NotificationEventType",
  "eventName" = CASE
    WHEN "topic" IN ('ASSIGNMENT_CONFLICT', 'EXAM_CONFLICT', 'TIMETABLE_CONFLICT') THEN 'sync_conflict.legacy'
    WHEN "title" LIKE 'Removed from DLU:%' OR "title" LIKE '%removed%' OR "title" LIKE '%changed%' THEN lower("topic"::text) || '.removed'
    WHEN "title" LIKE 'Updated:%' OR "title" LIKE '%is available' THEN lower("topic"::text) || '.updated'
    ELSE lower("topic"::text) || '.created'
  END;

ALTER TABLE "Notification" ALTER COLUMN "eventName" SET NOT NULL,
ALTER COLUMN "eventType" SET NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "syncConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "syncMissedAt" TIMESTAMP(3);

-- Every ingested row that predates this migration was already on the
-- calendar under the old single-sighting rule — treat it as already
-- confirmed (at its own creation instant) rather than pending, so the new
-- confirm gate doesn't retroactively hard-delete a real, already-seen item on
-- its next reconciliation run.
UPDATE "Session"
SET "syncConfirmedAt" = "createdAt"
WHERE "externalKey" IS NOT NULL AND "syncConfirmedAt" IS NULL;
