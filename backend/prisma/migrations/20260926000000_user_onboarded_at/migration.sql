ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Existing users predate onboarding: mark them done so they are not routed to it.
UPDATE "User" SET "onboardedAt" = "createdAt";
