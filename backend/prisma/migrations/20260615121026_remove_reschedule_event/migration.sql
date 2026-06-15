-- Remove the redundant RESCHEDULE event type: a user move IS a reschedule and is
-- already recorded as MOVE. Postgres cannot DROP a single enum value, so recreate
-- the type. Safe: no rows reference RESCHEDULE (it was never emitted).
ALTER TYPE "TaskEventType" RENAME TO "TaskEventType_old";

CREATE TYPE "TaskEventType" AS ENUM ('CREATE', 'MOVE', 'RESIZE', 'COMPLETE', 'ABANDON');

ALTER TABLE "TaskEvent"
  ALTER COLUMN "eventType" TYPE "TaskEventType"
  USING ("eventType"::text::"TaskEventType");

DROP TYPE "TaskEventType_old";
