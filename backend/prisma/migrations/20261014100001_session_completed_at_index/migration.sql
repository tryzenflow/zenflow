CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_userId_completedAt_idx" ON "Session"("userId", "completedAt");
