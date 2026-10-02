-- Issue #56 — rolling ingestion cadence + cross-student occurrence cache.
-- Entirely additive: nothing is dropped, nothing is rewritten, and no existing
-- row changes, so this can be deployed ahead of the code that reads any of it.
-- There is deliberately NO data step re-keying "Session"."externalKey":
-- pre-#56 portal lectures are adopted under their new key in place by
-- MaterializerService.adoptLegacyKey the next time a walk sees them. Doing it
-- in SQL would hard-code DLU_TZ and a copy of the period table that would
-- silently drift from the code.

-- CreateEnum
CREATE TYPE "IngestionSyncKind" AS ENUM ('PORTAL_DISCOVERY', 'LMS_DISCOVERY', 'PORTAL_TIMETABLE', 'PORTAL_EXAM', 'LMS_CALENDAR');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "lmsCourseId" INTEGER;

-- AlterTable
ALTER TABLE "LmsCourse" ADD COLUMN     "occurrencesFingerprint" TEXT,
ADD COLUMN     "occurrencesFingerprintBy" TEXT,
ADD COLUMN     "occurrencesPriorFingerprint" TEXT,
ADD COLUMN     "occurrencesRefreshedAt" TIMESTAMP(3),
ADD COLUMN     "occurrencesThroughDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PortalSection" ADD COLUMN     "timetableRefreshedAt" TIMESTAMP(3),
ADD COLUMN     "timetableThroughDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IngestionSchedule" (
    "id" TEXT NOT NULL,
    "kind" "IngestionSyncKind" NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastClaimedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastSuccessTerm" TEXT NOT NULL DEFAULT '',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "cacheHitStreak" INTEGER NOT NULL DEFAULT 0,
    "integrationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSectionEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "scheduleStudyUnitId" TEXT NOT NULL,
    "yearStudy" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "droppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalSectionEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsCourseEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "lmsCourseId" INTEGER NOT NULL,
    "courseCategory" TEXT,
    "startDate" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "currentTerm" BOOLEAN NOT NULL DEFAULT true,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "droppedAt" TIMESTAMP(3),
    "seenFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsCourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSectionOccurrence" (
    "id" TEXT NOT NULL,
    "scheduleStudyUnitId" TEXT NOT NULL,
    "meetingDate" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL,
    "numberOfPeriods" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "yearStudy" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "roomId" TEXT,
    "teacherName" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalSectionOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsCourseOccurrence" (
    "id" TEXT NOT NULL,
    "lmsCourseId" INTEGER NOT NULL,
    "externalKey" TEXT NOT NULL,
    "type" "SessionType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "location" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsCourseOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionSchedule_kind_nextDueAt_idx" ON "IngestionSchedule"("kind", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionSchedule_integrationId_kind_key" ON "IngestionSchedule"("integrationId", "kind");

-- CreateIndex
CREATE INDEX "PortalSectionEnrollment_scheduleStudyUnitId_droppedAt_idx" ON "PortalSectionEnrollment"("scheduleStudyUnitId", "droppedAt");

-- CreateIndex
CREATE INDEX "PortalSectionEnrollment_userId_droppedAt_idx" ON "PortalSectionEnrollment"("userId", "droppedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSectionEnrollment_userId_scheduleStudyUnitId_key" ON "PortalSectionEnrollment"("userId", "scheduleStudyUnitId");

-- CreateIndex
CREATE INDEX "LmsCourseEnrollment_lmsCourseId_droppedAt_idx" ON "LmsCourseEnrollment"("lmsCourseId", "droppedAt");

-- CreateIndex
CREATE INDEX "LmsCourseEnrollment_userId_droppedAt_idx" ON "LmsCourseEnrollment"("userId", "droppedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsCourseEnrollment_userId_lmsCourseId_key" ON "LmsCourseEnrollment"("userId", "lmsCourseId");

-- CreateIndex
CREATE INDEX "PortalSectionOccurrence_scheduleStudyUnitId_startsAt_idx" ON "PortalSectionOccurrence"("scheduleStudyUnitId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSectionOccurrence_scheduleStudyUnitId_meetingDate_per_key" ON "PortalSectionOccurrence"("scheduleStudyUnitId", "meetingDate", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsCourseOccurrence_externalKey_key" ON "LmsCourseOccurrence"("externalKey");

-- CreateIndex
CREATE INDEX "LmsCourseOccurrence_lmsCourseId_startsAt_idx" ON "LmsCourseOccurrence"("lmsCourseId", "startsAt");

-- CreateIndex
CREATE INDEX "Session_userId_lmsCourseId_idx" ON "Session"("userId", "lmsCourseId");

-- AddForeignKey
ALTER TABLE "IngestionSchedule" ADD CONSTRAINT "IngestionSchedule_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSectionEnrollment" ADD CONSTRAINT "PortalSectionEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSectionEnrollment" ADD CONSTRAINT "PortalSectionEnrollment_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSectionEnrollment" ADD CONSTRAINT "PortalSectionEnrollment_scheduleStudyUnitId_fkey" FOREIGN KEY ("scheduleStudyUnitId") REFERENCES "PortalSection"("scheduleStudyUnitId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsCourseEnrollment" ADD CONSTRAINT "LmsCourseEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsCourseEnrollment" ADD CONSTRAINT "LmsCourseEnrollment_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsCourseEnrollment" ADD CONSTRAINT "LmsCourseEnrollment_lmsCourseId_fkey" FOREIGN KEY ("lmsCourseId") REFERENCES "LmsCourse"("lmsCourseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSectionOccurrence" ADD CONSTRAINT "PortalSectionOccurrence_scheduleStudyUnitId_fkey" FOREIGN KEY ("scheduleStudyUnitId") REFERENCES "PortalSection"("scheduleStudyUnitId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsCourseOccurrence" ADD CONSTRAINT "LmsCourseOccurrence_lmsCourseId_fkey" FOREIGN KEY ("lmsCourseId") REFERENCES "LmsCourse"("lmsCourseId") ON DELETE CASCADE ON UPDATE CASCADE;

