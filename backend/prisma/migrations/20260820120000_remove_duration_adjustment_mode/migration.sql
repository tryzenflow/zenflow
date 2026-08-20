-- Removes the per-tag duration-bias correction feature (backend + shared
-- contract removal, docs/design-overview.md decision): the duration
-- corrector is gone, so its user-facing UX mode column and the index that
-- only served its telemetry aggregation query go too.

-- DropIndex: only ever served `SchedulerService.aggregateTagBias` (removed).
DROP INDEX "TaskEvent_userId_eventType_occurredAt_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "durationAdjustmentMode";

-- DropEnum
DROP TYPE "DurationAdjustmentMode";
