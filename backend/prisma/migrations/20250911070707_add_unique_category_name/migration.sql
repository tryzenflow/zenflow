/*
  Warnings:

  - A unique constraint covering the columns `[userId,name]` on the table `Category` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_name_key" ON "public"."Category"("userId", "name");
