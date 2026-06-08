-- DropIndex
DROP INDEX "Task_userId_seriesId_idx";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "rrule",
DROP COLUMN "seriesId";
