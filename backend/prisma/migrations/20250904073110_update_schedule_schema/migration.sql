/*
  Warnings:

  - Added the required column `date` to the `Schedule` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Schedule" ADD COLUMN     "date" DATE NOT NULL,
ALTER COLUMN "start" SET DATA TYPE TIME,
ALTER COLUMN "end" SET DATA TYPE TIME;
