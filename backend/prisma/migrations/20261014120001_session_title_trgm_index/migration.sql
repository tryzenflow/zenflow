CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_title_idx" ON "Session" USING GIN ("title" gin_trgm_ops);
