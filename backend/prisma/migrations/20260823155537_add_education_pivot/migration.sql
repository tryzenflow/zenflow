/*
  Warnings:

  - You are about to drop the column `workDays` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `workEnd` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `workStart` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "Language" AS ENUM ('vi-VN', 'en-US');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('MANUAL', 'ASSIGNMENT', 'EXAM', 'LECTURE');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('USER', 'LMS', 'PORTAL');

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

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "anchorEndTime" TIMESTAMP(3),
ADD COLUMN     "anchorStartTime" TIMESTAMP(3),
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "sessionIndex" INTEGER,
ADD COLUMN     "sessionTotal" INTEGER,
ADD COLUMN     "source" "TaskSource" NOT NULL DEFAULT 'USER',
ADD COLUMN     "type" "TaskType" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "workDays",
DROP COLUMN "workEnd",
DROP COLUMN "workStart",
ADD COLUMN     "lang" "Language" NOT NULL DEFAULT 'vi-VN',
ALTER COLUMN "timezone" SET DEFAULT 'Asia/Saigon';

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
CREATE TABLE "TaskSeries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReminder" (
    "id" TEXT NOT NULL,
    "remindBeforeMinutes" INTEGER NOT NULL DEFAULT 15,
    "taskId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SlotProposal" (
    "id" TEXT NOT NULL,
    "event" "SlotProposalEvent" NOT NULL,
    "pickedModel" "SchedulingModel" NOT NULL,
    "heuristicProposal" JSONB NOT NULL,
    "linucbProposal" JSONB NOT NULL,
    "batchId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

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
    "taskId" TEXT,

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

-- CreateIndex
CREATE INDEX "UserEncryptionKey_userId_idx" ON "UserEncryptionKey"("userId");

-- CreateIndex
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

-- CreateIndex
CREATE INDEX "TaskSeries_userId_idx" ON "TaskSeries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReminder_remindBeforeMinutes_taskId_key" ON "TaskReminder"("remindBeforeMinutes", "taskId");

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
CREATE INDEX "Task_userId_seriesId_createdAt_idx" ON "Task"("userId", "seriesId", "createdAt" ASC);

-- AddForeignKey
ALTER TABLE "UserEncryptionKey" ADD CONSTRAINT "UserEncryptionKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSeries" ADD CONSTRAINT "TaskSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TaskSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotProposal" ADD CONSTRAINT "SlotProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotProposal" ADD CONSTRAINT "SlotProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJobItem" ADD CONSTRAINT "CrawlJobItem_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "CrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAPIJob" ADD CONSTRAINT "PortalAPIJob_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAPIJobItem" ADD CONSTRAINT "PortalAPIJobItem_portalApiJobId_fkey" FOREIGN KEY ("portalApiJobId") REFERENCES "PortalAPIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
