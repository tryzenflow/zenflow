/*
  Warnings:

  - A unique constraint covering the columns `[userId,weekday]` on the table `Constraint` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Constraint_userId_weekday_key" ON "public"."Constraint"("userId", "weekday");
