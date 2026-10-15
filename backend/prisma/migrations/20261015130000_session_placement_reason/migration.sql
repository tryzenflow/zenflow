-- CreateEnum
CREATE TYPE "PlacementReason" AS ENUM ('PREFERRED_HOUR', 'BEFORE_DEADLINE', 'ONLY_FREE_SLOT', 'NEAR_CLASS', 'MOVED_FOR_DEADLINE', 'BEST_AVAILABLE');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "placementReason" "PlacementReason",
ADD COLUMN     "placementReasonStartAt" TIMESTAMP(3);
