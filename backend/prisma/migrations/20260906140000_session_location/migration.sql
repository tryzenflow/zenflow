-- Optional free-text location for a session (room / building / campus).
-- Nullable, no backfill: existing rows keep NULL. The DLU watchers populate
-- it for ingested fixed sessions (portal `PhongThi`/`RoomID`, Moodle event
-- `location`); the scheduler never reads it.
ALTER TABLE "Session" ADD COLUMN "location" TEXT;
