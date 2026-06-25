-- Upgrade: preference matrix 7×8 (56 cells) → 7×24 (168 cells, 1-hour buckets)
--
-- When to run:
--   1. Bump PREFERENCE_SLOTS_PER_DAY from 8 to 24 in packages/shared/src/view.ts
--      and redeploy the backend so new events are written at 1-hour resolution.
--   2. Run this script to upscale existing user matrices in-place.
--
-- Strategy: each 3-hour bucket score is replicated across its 3 constituent
-- 1-hour cells (e.g. bucket 3 score +6 → hours 9, 10, 11 each get +2... no,
-- actually the value is copied as-is: +6 → hours 9, 10, 11 each get +6).
-- Splitting would under-weight the prior signal; copying preserves the relative
-- ordering that the softmax re-ranker cares about. Fine-grained hour preferences
-- diverge naturally as new 1-hour-resolution events accumulate on top.
--
-- Idempotent: only rows with exactly 56 cells are touched. Safe to re-run.
--
-- Apply:
--   psql $DATABASE_URL -f backend/scripts/upgrade-matrix-7x8-to-7x24.sql
--   # or via psql in the Docker stack:
--   # docker exec -i <db-container> psql -U <user> <dbname> < backend/scripts/upgrade-matrix-7x8-to-7x24.sql

UPDATE "User"
SET "preferenceMatrix" = (
  SELECT ARRAY(
    SELECT elem
    FROM unnest("preferenceMatrix") WITH ORDINALITY AS t(elem, ord)
    CROSS JOIN generate_series(1, 3) AS rep
    ORDER BY ord, rep
  )
)
WHERE array_length("preferenceMatrix", 1) = 56;
