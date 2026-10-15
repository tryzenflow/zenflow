CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_title_unaccent_idx" ON "Session" USING GIN (immutable_unaccent("title") gin_trgm_ops);
