/*
  Warnings:

  - You are about to drop the column `schedulingAnchor` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `view` on the `Task` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "schedulingAnchor",
DROP COLUMN "view";
