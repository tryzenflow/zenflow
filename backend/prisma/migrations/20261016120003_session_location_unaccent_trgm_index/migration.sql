CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_location_unaccent_idx" ON "Session" USING GIN (immutable_unaccent("location") gin_trgm_ops);
