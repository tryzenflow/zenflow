-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "scheduleStudyUnitId" TEXT;

-- CreateIndex
CREATE INDEX "Session_userId_scheduleStudyUnitId_idx" ON "Session"("userId", "scheduleStudyUnitId");
