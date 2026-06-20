-- CreateEnum: the per-tag duration-corrector UX mode (mirrors @zenflow/shared
-- DurationAdjustmentMode). Lowercase labels, like the ViewMode precedent.
CREATE TYPE "DurationAdjustmentMode" AS ENUM ('auto', 'ask', 'never');

-- AlterTable: two additive columns on User, no backfill needed.
--   durationAdjustmentMode    → defaults to 'auto' for every existing row.
--   preferenceMatrixDecayedAt → nullable; the daily decay cron treats null as
--                               "no elapsed days" and only stamps the time.
ALTER TABLE "User"
  ADD COLUMN "durationAdjustmentMode" "DurationAdjustmentMode" NOT NULL DEFAULT 'auto',
  ADD COLUMN "preferenceMatrixDecayedAt" TIMESTAMP(3);
