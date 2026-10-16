CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tag_name_unaccent_idx" ON "Tag" USING GIN (immutable_unaccent("name") gin_trgm_ops);
