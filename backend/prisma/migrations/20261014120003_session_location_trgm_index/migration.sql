CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_location_idx" ON "Session" USING GIN ("location" gin_trgm_ops);
