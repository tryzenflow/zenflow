-- LinUCB slot score dropped the preference-matrix term (wP); the second applied
-- weight is now the proximity-scaled stability weight (wS).
ALTER TABLE "SlotProposal" RENAME COLUMN "preferenceWeight" TO "stabilityWeight";
