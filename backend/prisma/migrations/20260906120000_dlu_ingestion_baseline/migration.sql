-- AlterTable
-- Stable identity of the upstream DLU item a session mirrors
-- ("lms:assign:<instance>", "lms:quiz:<instance>", "portal:exam:<Examination>",
-- "portal:meeting:<WeekScheduleID>"); null for user-created sessions. The
-- unique index below is the ingestion idempotency guard — the watchers upsert
-- on (userId, externalKey), so re-running a cron tick can't duplicate the
-- student's calendar.
ALTER TABLE "Session" ADD COLUMN     "externalKey" TEXT;

-- AlterTable
-- Match PortalAPIJobItem so a bad LMS parse is diagnosable from the job row.
ALTER TABLE "CrawlJobItem" ADD COLUMN     "responseBody" TEXT,
ADD COLUMN     "statusCode" INTEGER;

-- CreateTable
CREATE TABLE "LmsCourse" (
    "id" TEXT NOT NULL,
    "lmsCourseId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "shortName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSection" (
    "id" TEXT NOT NULL,
    "scheduleStudyUnitId" TEXT NOT NULL,
    "curriculumId" TEXT,
    "curriculumName" TEXT NOT NULL,
    "yearStudy" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "groupNo" TEXT,
    "teacherName" TEXT,
    "roomId" TEXT,
    "buildingName" TEXT,
    "campusName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LmsCourse_lmsCourseId_key" ON "LmsCourse"("lmsCourseId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSection_scheduleStudyUnitId_key" ON "PortalSection"("scheduleStudyUnitId");

-- CreateIndex
CREATE INDEX "PortalSection_yearStudy_termId_idx" ON "PortalSection"("yearStudy", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_userId_externalKey_key" ON "Session"("userId", "externalKey");
