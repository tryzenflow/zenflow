-- CreateEnum
CREATE TYPE "SessionAnchor" AS ENUM ('AUTO', 'CHOSEN', 'PINNED');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "anchor" "SessionAnchor" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "anchoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SessionEvent" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "PlacementPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectFrom" TIMESTAMP(3),
    "startAt" TIMESTAMP(3) NOT NULL,
    "moves" JSONB NOT NULL,
    "createInput" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementPlan_userId_idx" ON "PlacementPlan"("userId");

-- CreateIndex
CREATE INDEX "SessionEvent_groupId_idx" ON "SessionEvent"("groupId");

-- AddForeignKey
ALTER TABLE "PlacementPlan" ADD CONSTRAINT "PlacementPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

