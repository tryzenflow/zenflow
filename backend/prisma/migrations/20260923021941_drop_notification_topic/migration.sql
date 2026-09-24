/*
  Warnings:

  - You are about to drop the column `topic` on the `Notification` table.
    `eventName` already encodes the assignment/exam/lecture/reminder category
    (see `notificationCategory` in @zenflow/shared), so the column is
    redundant rather than dropped data.

*/

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "topic";

-- DropEnum
DROP TYPE "NotificationTopic";
