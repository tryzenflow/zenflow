/*
  Warnings:

  - You are about to drop the column `topic` on the `Notification` table.
    `eventName` already encodes the assignment/exam/lecture/reminder category
    (see `notificationCategory` in @zenflow/shared), so the column is
    redundant rather than dropped data.

*/

-- Realign existing rows onto the `<thing>.<action>` naming `eventName`
-- everywhere else already uses ("lecture.created", not "timetable.group_created")
-- so `notificationCategory()` can parse every row, old or new.
UPDATE "Notification"
SET "eventName" = 'lecture.group_created'
WHERE "eventName" = 'timetable.group_created';

UPDATE "Notification"
SET "eventName" = 'lecture.group_updated'
WHERE "eventName" = 'timetable.group_updated';

UPDATE "Notification"
SET "eventName" = 'lecture.group_removed'
WHERE "eventName" = 'timetable.group_removed';

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "topic";

-- DropEnum
DROP TYPE "NotificationTopic";
