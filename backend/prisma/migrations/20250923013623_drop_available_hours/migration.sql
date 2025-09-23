/*
  Warnings:

  - You are about to drop the `AvailableHour` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."AvailableHour" DROP CONSTRAINT "AvailableHour_constraintId_fkey";

-- DropTable
DROP TABLE "public"."AvailableHour";
