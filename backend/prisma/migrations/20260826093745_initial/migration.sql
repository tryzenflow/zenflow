-- CreateEnum
CREATE TYPE "Language" AS ENUM ('vi-VN', 'en-US');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'DONE', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('MANUAL', 'ASSIGNMENT', 'EXAM', 'LECTURE');

-- CreateEnum
CREATE TYPE "SessionSource" AS ENUM ('USER', 'LMS', 'PORTAL');

-- CreateEnum
CREATE TYPE "SessionEventType" AS ENUM ('CREATE', 'MOVE', 'RESIZE', 'KEEP', 'COMPLETE', 'ABANDON', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "SlotProposalEvent" AS ENUM ('CREATE', 'RESCHEDULE');

-- CreateEnum
CREATE TYPE "SchedulingModel" AS ENUM ('HEURISTIC', 'LINUCB');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('LMS', 'PORTAL');

-- CreateEnum
CREATE TYPE "NotificationTopic" AS ENUM ('ASSIGNMENT', 'EXAM', 'TIMETABLE', 'REMINDER', 'OVERDUE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Saigon',
    "lang" "Language" NOT NULL DEFAULT 'vi-VN',
    "preferenceMatrix" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "preferenceMatrixDecayedAt" TIMESTAMP(3),
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEncryptionKey" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserEncryptionKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "pushToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionSeries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SessionSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "startTime" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "type" "SessionType" NOT NULL DEFAULT 'MANUAL',
    "source" "SessionSource" NOT NULL DEFAULT 'USER',
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "scheduledStartTime" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "seriesId" TEXT,
    "sessionIndex" INTEGER,
    "sessionTotal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionReminder" (
    "id" TEXT NOT NULL,
    "remindBeforeMinutes" INTEGER NOT NULL DEFAULT 15,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "SessionReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventType" "SessionEventType" NOT NULL,
    "oldSnapshot" JSONB,
    "newSnapshot" JSONB NOT NULL,
    "rewardScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotProposal" (
    "id" TEXT NOT NULL,
    "event" "SlotProposalEvent" NOT NULL,
    "pickedModel" "SchedulingModel" NOT NULL,
    "heuristicProposal" JSONB NOT NULL,
    "linucbProposal" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "SlotProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "actionTakenAt" TIMESTAMP(3),
    "topic" "NotificationTopic" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlJob" (
    "id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "CrawlJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlJobItem" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crawlJobId" TEXT NOT NULL,

    CONSTRAINT "CrawlJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawledUrl" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawledUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAPIJob" (
    "id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "PortalAPIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAPIJobItem" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portalApiJobId" TEXT NOT NULL,

    CONSTRAINT "PortalAPIJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_SessionToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SessionToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserEncryptionKey_userId_idx" ON "UserEncryptionKey"("userId");

-- CreateIndex
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

-- CreateIndex
CREATE INDEX "SessionSeries_userId_idx" ON "SessionSeries"("userId");

-- CreateIndex
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_name_key" ON "Tag"("userId", "name");

-- CreateIndex
CREATE INDEX "Session_userId_deadline_idx" ON "Session"("userId", "deadline");

-- CreateIndex
CREATE INDEX "Session_userId_status_idx" ON "Session"("userId", "status");

-- CreateIndex
CREATE INDEX "Session_userId_scheduledStartTime_idx" ON "Session"("userId", "scheduledStartTime");

-- CreateIndex
CREATE INDEX "Session_userId_seriesId_createdAt_idx" ON "Session"("userId", "seriesId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "SessionReminder_sessionId_idx" ON "SessionReminder"("sessionId");

-- CreateIndex
CREATE INDEX "SessionEvent_userId_occurredAt_idx" ON "SessionEvent"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_idx" ON "SessionEvent"("sessionId");

-- CreateIndex
CREATE INDEX "File_userId_idx" ON "File"("userId");

-- CreateIndex
CREATE INDEX "Integration_provider_userId_idx" ON "Integration"("provider", "userId");

-- CreateIndex
CREATE INDEX "Integration_encryptionVersion_idx" ON "Integration"("encryptionVersion" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_userId_provider_key" ON "Integration"("userId", "provider");

-- CreateIndex
CREATE INDEX "Notification_userId_sentAt_idx" ON "Notification"("userId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "CrawlJobItem_crawlJobId_idx" ON "CrawlJobItem"("crawlJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawledUrl_url_key" ON "CrawledUrl"("url");

-- CreateIndex
CREATE INDEX "PortalAPIJobItem_portalApiJobId_idx" ON "PortalAPIJobItem"("portalApiJobId");

-- CreateIndex
CREATE INDEX "_SessionToTag_B_index" ON "_SessionToTag"("B");

-- AddForeignKey
ALTER TABLE "UserEncryptionKey" ADD CONSTRAINT "UserEncryptionKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSeries" ADD CONSTRAINT "SessionSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "SessionSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReminder" ADD CONSTRAINT "SessionReminder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotProposal" ADD CONSTRAINT "SlotProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotProposal" ADD CONSTRAINT "SlotProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJobItem" ADD CONSTRAINT "CrawlJobItem_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAPIJob" ADD CONSTRAINT "PortalAPIJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAPIJobItem" ADD CONSTRAINT "PortalAPIJobItem_portalApiJobId_fkey" FOREIGN KEY ("portalApiJobId") REFERENCES "PortalAPIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SessionToTag" ADD CONSTRAINT "_SessionToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SessionToTag" ADD CONSTRAINT "_SessionToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
