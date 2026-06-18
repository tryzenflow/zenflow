-- AlterEnum: positive accepted-unchanged signal (task completed in the slot the
-- engine suggested). Added BEFORE 'COMPLETE' to match the schema declaration
-- order. ADD VALUE is not used elsewhere in this migration, so it applies
-- outside a value-use transaction (safe on PostgreSQL 12+).
ALTER TYPE "TaskEventType" ADD VALUE 'KEEP' BEFORE 'COMPLETE';
