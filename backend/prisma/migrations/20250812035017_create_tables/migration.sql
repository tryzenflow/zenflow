-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "email" VARCHAR(30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" VARCHAR(50) NOT NULL,
    "maxDeepWorkHours" SMALLINT NOT NULL DEFAULT 4,
    "batchSimilarTasks" BOOLEAN NOT NULL DEFAULT true,
    "minBreakMinutesBetweenTasks" SMALLINT NOT NULL DEFAULT 15,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "note" TEXT,
    "priority" SMALLINT NOT NULL DEFAULT 1,
    "date" DATE NOT NULL,
    "deadline" TIMESTAMP(3),
    "remindBeforeMinutes" SMALLINT,
    "durationInMinutes" SMALLINT NOT NULL,
    "isInWorkingHours" BOOLEAN NOT NULL DEFAULT true,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "startTime" TIME,
    "endTime" TIME,
    "repeatUntil" DATE,
    "repeatEveryDays" SMALLINT,
    "mentalEnergyLevel" SMALLINT NOT NULL DEFAULT 1,
    "physicalEnergyLevel" SMALLINT NOT NULL DEFAULT 3,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Dependency" (
    "currentTaskId" INTEGER NOT NULL,
    "prerequisiteTaskId" INTEGER NOT NULL,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("currentTaskId","prerequisiteTaskId")
);

-- CreateTable
CREATE TABLE "public"."EnergyLevel" (
    "id" SERIAL NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "mental" SMALLINT NOT NULL DEFAULT 1,
    "physical" SMALLINT NOT NULL DEFAULT 3,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "EnergyLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkingHoursBlock" (
    "id" SERIAL NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "WorkingHoursBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_CategoryToTask" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CategoryToTask_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "_CategoryToTask_B_index" ON "public"."_CategoryToTask"("B");

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dependency" ADD CONSTRAINT "Dependency_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Dependency" ADD CONSTRAINT "Dependency_prerequisiteTaskId_fkey" FOREIGN KEY ("prerequisiteTaskId") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnergyLevel" ADD CONSTRAINT "EnergyLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkingHoursBlock" ADD CONSTRAINT "WorkingHoursBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_CategoryToTask" ADD CONSTRAINT "_CategoryToTask_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_CategoryToTask" ADD CONSTRAINT "_CategoryToTask_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
