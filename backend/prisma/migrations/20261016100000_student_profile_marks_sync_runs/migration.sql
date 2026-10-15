-- CreateEnum
CREATE TYPE "SyncUnitStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "StudentProfile" (
    "userId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "studentId" TEXT,
    "fullName" TEXT NOT NULL,
    "gender" TEXT,
    "cohort" TEXT,
    "className" TEXT,
    "faculty" TEXT,
    "major" TEXT,
    "studyProgramId" TEXT,
    "studyProgramName" TEXT,
    "gpa4" DOUBLE PRECISION,
    "gpa10" DOUBLE PRECISION,
    "creditsEarned" INTEGER,
    "ranking" TEXT,
    "profileFetchedAt" TIMESTAMP(3) NOT NULL,
    "marksFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "StudyProgram" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studyProgramId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentMark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleStudyUnitId" TEXT NOT NULL,
    "yearStudy" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "curriculumId" TEXT,
    "curriculumName" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "score10" DOUBLE PRECISION,
    "score4" DOUBLE PRECISION,
    "letter" TEXT,
    "passed" BOOLEAN,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentTermResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yearStudy" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "gpa4" DOUBLE PRECISION,
    "gpa10" DOUBLE PRECISION,
    "creditsEarned" INTEGER,
    "cumulativeGpa4" DOUBLE PRECISION,
    "cumulativeGpa10" DOUBLE PRECISION,
    "cumulativeCredits" INTEGER,
    "conductScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentTermResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalWeekCoverage" (
    "scheduleStudyUnitId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalWeekCoverage_pkey" PRIMARY KEY ("scheduleStudyUnitId","weekStart")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" "IngestionSyncKind" NOT NULL,
    "scope" TEXT NOT NULL,
    "totalUnits" INTEGER NOT NULL,
    "scheduleId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "cacheHitStreak" INTEGER NOT NULL DEFAULT 0,
    "servedFromCache" BOOLEAN NOT NULL DEFAULT true,
    "notifiedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRunUnit" (
    "runId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "status" "SyncUnitStatus" NOT NULL DEFAULT 'PENDING',
    "fetched" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SyncRunUnit_pkey" PRIMARY KEY ("runId","unit")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyProgram_userId_studyProgramId_key" ON "StudyProgram"("userId", "studyProgramId");

-- CreateIndex
CREATE INDEX "StudentMark_userId_yearStudy_termId_idx" ON "StudentMark"("userId", "yearStudy", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentMark_userId_scheduleStudyUnitId_key" ON "StudentMark"("userId", "scheduleStudyUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentTermResult_userId_yearStudy_termId_key" ON "StudentTermResult"("userId", "yearStudy", "termId");

-- CreateIndex
CREATE INDEX "SyncRun_integrationId_kind_createdAt_idx" ON "SyncRun"("integrationId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_finishedAt_createdAt_idx" ON "SyncRun"("finishedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProgram" ADD CONSTRAINT "StudyProgram_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMark" ADD CONSTRAINT "StudentMark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentTermResult" ADD CONSTRAINT "StudentTermResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRunUnit" ADD CONSTRAINT "SyncRunUnit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
