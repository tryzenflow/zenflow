-- CreateEnum
CREATE TYPE "PlacementSource" AS ENUM ('PYTHON', 'TS_FALLBACK');

-- AlterTable
ALTER TABLE "SlotProposal" ADD COLUMN "placementSource" "PlacementSource" NOT NULL DEFAULT 'PYTHON',
ADD COLUMN "degradedReason" TEXT;

-- Backfill: LinUCB-primary events that produced no model proposal were already
-- heuristic fallbacks (ADR-0003 section 4).
UPDATE "SlotProposal"
SET "placementSource" = 'TS_FALLBACK'
WHERE "modelProposal" IS NULL AND "primaryPolicy" = 'LINUCB';
