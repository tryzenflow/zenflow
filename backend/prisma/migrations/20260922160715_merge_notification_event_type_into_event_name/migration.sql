/*
  Warnings:

  - You are about to drop the column `eventType` on the `Notification` table.
    `eventName` already encodes the same created/updated/removed/conflict
    classification (see `notificationEventKind` in @zenflow/shared), so the
    column is redundant rather than dropped data.

*/
-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "eventType";

-- DropEnum
DROP TYPE "NotificationEventType";
