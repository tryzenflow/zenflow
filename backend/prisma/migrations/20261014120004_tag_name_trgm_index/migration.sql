CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tag_name_idx" ON "Tag" USING GIN ("name" gin_trgm_ops);
