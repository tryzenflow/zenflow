/*
  Warnings:

  - You are about to drop the `RepeatRule` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."RepeatRule" DROP CONSTRAINT "RepeatRule_taskId_fkey";

-- AlterTable
ALTER TABLE "public"."Task" ADD COLUMN     "rrule" TEXT;

-- DropTable
DROP TABLE "public"."RepeatRule";

-- DropEnum
DROP TYPE "public"."RepeatType";
