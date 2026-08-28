/*
  Warnings:

  - Added the required column `authTag` to the `UserEncryptionKey` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "iv" TEXT;

-- AlterTable
ALTER TABLE "UserEncryptionKey" ADD COLUMN     "authTag" TEXT NOT NULL;
