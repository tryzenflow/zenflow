-- Reset stale 672-cell matrices; users re-learn under the new 7×8 geometry.
UPDATE "User"
SET "preferenceMatrix" = ARRAY[]::integer[]
WHERE array_length("preferenceMatrix", 1) = 672;
