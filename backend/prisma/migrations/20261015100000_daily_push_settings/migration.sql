-- Morning brief and evening check-in push times (issue #255). NULL = off.
ALTER TABLE "User"
  ADD COLUMN "morningBriefTime" VARCHAR(5),
  ADD COLUMN "eveningCheckinTime" VARCHAR(5);
