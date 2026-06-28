-- Fix: change preferenceMatrix from INTEGER[] to DOUBLE PRECISION[]
--
-- Root cause: decayMatrix() returns floats (e.g. 0.9677 after one day with
-- a 21-day half-life), but INTEGER[] storage caused the pg driver to truncate
-- these to integers (0.9677 → 0) on the first nightly decay run. Any cell
-- that was only incremented once (value 1) was immediately zeroed out the
-- next morning, making the preference heatmap "quickly go all gray."
--
-- With DOUBLE PRECISION[] the decay accumulates sub-integer precision
-- correctly (1.0 → 0.9677 → 0.936 → … → 0) over the intended 21-day
-- half-life without rounding artefacts at each daily step.
--
-- Existing integer values (1, -1, 2, …) are widened losslessly to float.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "preferenceMatrix" TYPE DOUBLE PRECISION[];
