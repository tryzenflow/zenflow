-- CreateEnum
CREATE TYPE "ViewMode" AS ENUM ('day', 'week', 'month');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "view" "ViewMode";
