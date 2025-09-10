-- DropForeignKey
ALTER TABLE "public"."Task" DROP CONSTRAINT "Task_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
