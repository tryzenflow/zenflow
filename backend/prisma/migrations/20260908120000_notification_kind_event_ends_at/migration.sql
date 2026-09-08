-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('NEW', 'CHANGE', 'DROP');

-- AlterTable
ALTER TABLE "Notification"
  ADD COLUMN "kind" "NotificationKind" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "eventEndsAt" TIMESTAMP(3);
