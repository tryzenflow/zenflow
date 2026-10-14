-- Issue #241: trigram indexes behind GET /sessions/search.
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "Session_title_idx" ON "Session" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Session_note_idx" ON "Session" USING GIN ("note" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Session_location_idx" ON "Session" USING GIN ("location" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Tag_name_idx" ON "Tag" USING GIN ("name" gin_trgm_ops);
