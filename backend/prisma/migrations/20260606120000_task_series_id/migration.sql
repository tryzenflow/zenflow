-- AlterTable
ALTER TABLE "Task" ADD COLUMN "seriesId" TEXT;

-- CreateIndex
CREATE INDEX "Task_userId_seriesId_idx" ON "Task"("userId", "seriesId");
