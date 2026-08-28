/*
  Warnings:

  - A unique constraint covering the columns `[userId,provider,version]` on the table `UserEncryptionKey` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `masterKeyVersion` to the `UserEncryptionKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provider` to the `UserEncryptionKey` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "UserEncryptionKey_userId_version_key";

-- AlterTable
ALTER TABLE "UserEncryptionKey" ADD COLUMN     "masterKeyVersion" INTEGER NOT NULL,
ADD COLUMN     "provider" "IntegrationProvider" NOT NULL;

-- CreateIndex
CREATE INDEX "UserEncryptionKey_userId_provider_version_idx" ON "UserEncryptionKey"("userId", "provider", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserEncryptionKey_userId_provider_version_key" ON "UserEncryptionKey"("userId", "provider", "version");
