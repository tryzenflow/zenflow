-- CreateIndex
CREATE UNIQUE INDEX "UserEncryptionKey_userId_version_key" ON "UserEncryptionKey"("userId", "version");
