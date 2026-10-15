-- Onboarding focus band (issue #253). NULL = not asked yet.
-- CreateEnum
CREATE TYPE "FocusBand" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'LATE_NIGHT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "focusBand" "FocusBand";
