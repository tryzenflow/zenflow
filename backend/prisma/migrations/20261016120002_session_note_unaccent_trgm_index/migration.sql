CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_note_unaccent_idx" ON "Session" USING GIN (immutable_unaccent("note") gin_trgm_ops);
