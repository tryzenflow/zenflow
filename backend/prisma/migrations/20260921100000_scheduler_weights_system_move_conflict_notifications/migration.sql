-- AlterEnum
ALTER TYPE "SessionEventType" ADD VALUE 'SYSTEM_MOVE';

-- AlterEnum
ALTER TYPE "NotificationTopic" ADD VALUE 'ASSIGNMENT_CONFLICT';
ALTER TYPE "NotificationTopic" ADD VALUE 'EXAM_CONFLICT';
ALTER TYPE "NotificationTopic" ADD VALUE 'TIMETABLE_CONFLICT';

-- AlterTable
ALTER TABLE "SlotProposal" ADD COLUMN "linucbWeight" DOUBLE PRECISION,
ADD COLUMN "preferenceWeight" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "conflictSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
