CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_note_idx" ON "Session" USING GIN ("note" gin_trgm_ops);
