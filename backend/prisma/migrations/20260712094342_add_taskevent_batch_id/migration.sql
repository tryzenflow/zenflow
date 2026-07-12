-- AlterTable
ALTER TABLE "TaskEvent" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "TaskEvent_userId_batchId_idx" ON "TaskEvent"("userId", "batchId");
