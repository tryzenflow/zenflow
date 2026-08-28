/*
  Warnings:

  - You are about to drop the column `onboardingComplete` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "authTag" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "onboardingComplete";
