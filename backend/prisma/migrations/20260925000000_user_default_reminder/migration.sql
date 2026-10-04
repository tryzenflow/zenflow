-- Existing users keep the 60-minute reminder sessions got before this setting
-- existed; only rows created afterwards default to 10.
ALTER TABLE "User" ADD COLUMN "defaultReminderMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "User" ALTER COLUMN "defaultReminderMinutes" SET DEFAULT 10;
