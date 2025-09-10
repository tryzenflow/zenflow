/*
  Warnings:

  - The `fixedStart` column on the `Task` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `earliestStart` column on the `Task` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `latestEnd` column on the `Task` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "public"."Task" DROP COLUMN "fixedStart",
ADD COLUMN     "fixedStart" SMALLINT,
DROP COLUMN "earliestStart",
ADD COLUMN     "earliestStart" SMALLINT,
DROP COLUMN "latestEnd",
ADD COLUMN     "latestEnd" SMALLINT;
