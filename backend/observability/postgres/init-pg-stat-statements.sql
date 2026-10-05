-- Runs once on an empty data dir (staging only). Needs
-- shared_preload_libraries=pg_stat_statements, set on the postgres command line.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
