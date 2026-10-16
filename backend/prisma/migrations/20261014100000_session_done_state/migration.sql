-- AlterEnum
ALTER TYPE "SessionEventType" ADD VALUE 'COMPLETE';
ALTER TYPE "SessionEventType" ADD VALUE 'SKIP';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "skipped" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SessionOccurrenceState" (
    "id" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionOccurrenceState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStreak" (
    "userId" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "longest" INTEGER NOT NULL DEFAULT 0,
    "freezesAvailable" INTEGER NOT NULL DEFAULT 0,
    "frozenDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastActiveDay" VARCHAR(10),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStreak_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "SessionOccurrenceState_userId_completedAt_idx" ON "SessionOccurrenceState"("userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionOccurrenceState_seriesId_occurrenceStart_key" ON "SessionOccurrenceState"("seriesId", "occurrenceStart");

-- AddForeignKey
ALTER TABLE "SessionOccurrenceState" ADD CONSTRAINT "SessionOccurrenceState_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SessionSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionOccurrenceState" ADD CONSTRAINT "SessionOccurrenceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStreak" ADD CONSTRAINT "UserStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

