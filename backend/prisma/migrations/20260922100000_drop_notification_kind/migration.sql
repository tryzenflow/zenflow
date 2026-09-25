-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "kind";

-- DropEnum
DROP TYPE "NotificationKind";
