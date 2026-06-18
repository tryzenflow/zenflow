-- AlterTable: re-grid + sign the per-user matrix. The 336-int (7×48, 30-min)
-- penalty matrix becomes the 672-int (7×96, 15-min) SIGNED preference matrix.
-- Existing rows keep their (now wrong-length) array; the service seeds the
-- matrix lazily to all-zero on the next write, so a plain rename is safe.
ALTER TABLE "User" RENAME COLUMN "penaltyMatrix" TO "preferenceMatrix";
