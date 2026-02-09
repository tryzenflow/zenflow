/*
  Warnings:

  - You are about to drop the `ScheduleResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_EventToScheduleResult` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."ScheduleResult" DROP CONSTRAINT "ScheduleResult_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."_EventToScheduleResult" DROP CONSTRAINT "_EventToScheduleResult_A_fkey";

-- DropForeignKey
ALTER TABLE "public"."_EventToScheduleResult" DROP CONSTRAINT "_EventToScheduleResult_B_fkey";

-- AlterTable
ALTER TABLE "public"."Event" ADD COLUMN     "isDirty" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "end" DROP NOT NULL;

-- DropTable
DROP TABLE "public"."ScheduleResult";

-- DropTable
DROP TABLE "public"."_EventToScheduleResult";
