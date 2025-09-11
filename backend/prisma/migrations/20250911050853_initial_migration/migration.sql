-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "email" VARCHAR(30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" VARCHAR(50) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "fixedStart" SMALLINT,
    "earliestStart" SMALLINT,
    "latestEnd" SMALLINT,
    "deadline" TIMESTAMP(3),
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "splittable" BOOLEAN NOT NULL DEFAULT false,
    "maxSplits" INTEGER NOT NULL DEFAULT 1,
    "energyLevel" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Schedule" (
    "date" DATE NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "split" SMALLINT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("taskId","split","date")
);

-- CreateTable
CREATE TABLE "public"."Constraints" (
    "minGapBetweenTasks" INTEGER NOT NULL DEFAULT 0,
    "maxDailyLoad" INTEGER NOT NULL DEFAULT 1440,
    "batchSimilarTasks" BOOLEAN NOT NULL DEFAULT true,
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AvailableHour" (
    "id" TEXT NOT NULL,
    "start" SMALLINT NOT NULL,
    "end" SMALLINT NOT NULL,
    "constraintsId" TEXT NOT NULL,

    CONSTRAINT "AvailableHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EnergyBlock" (
    "id" TEXT NOT NULL,
    "energyLevel" SMALLINT NOT NULL,
    "start" SMALLINT NOT NULL,
    "end" SMALLINT NOT NULL,
    "constraintsId" TEXT NOT NULL,

    CONSTRAINT "EnergyBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_TaskPrerequisites" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskPrerequisites_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "_TaskPrerequisites_B_index" ON "public"."_TaskPrerequisites"("B");

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Schedule" ADD CONSTRAINT "Schedule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Constraints" ADD CONSTRAINT "Constraints_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AvailableHour" ADD CONSTRAINT "AvailableHour_constraintsId_fkey" FOREIGN KEY ("constraintsId") REFERENCES "public"."Constraints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnergyBlock" ADD CONSTRAINT "EnergyBlock_constraintsId_fkey" FOREIGN KEY ("constraintsId") REFERENCES "public"."Constraints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TaskPrerequisites" ADD CONSTRAINT "_TaskPrerequisites_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_TaskPrerequisites" ADD CONSTRAINT "_TaskPrerequisites_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
