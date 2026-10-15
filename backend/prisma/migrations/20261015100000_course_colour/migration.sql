-- CreateTable
CREATE TABLE "CourseColour" (
    "id" TEXT NOT NULL,
    "courseKey" VARCHAR(120) NOT NULL,
    "swatch" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CourseColour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseColour_userId_courseKey_key" ON "CourseColour"("userId", "courseKey");

-- AddForeignKey
ALTER TABLE "CourseColour" ADD CONSTRAINT "CourseColour_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
