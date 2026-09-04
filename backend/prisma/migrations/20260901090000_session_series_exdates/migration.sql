-- Individually-deleted occurrences of a recurring series (rrule series only).
-- ISO-8601 instant strings; occurrences matching one are filtered out of the
-- virtual expansion in SessionsService.list().
ALTER TABLE "SessionSeries" ADD COLUMN "exdates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
