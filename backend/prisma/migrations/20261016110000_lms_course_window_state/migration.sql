-- CreateTable
CREATE TABLE "LmsCourseWindow" (
    "lmsCourseId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,
    "throughDate" TIMESTAMP(3) NOT NULL,
    "fingerprint" TEXT,
    "fingerprintBy" TEXT,
    "priorFingerprint" TEXT,

    CONSTRAINT "LmsCourseWindow_pkey" PRIMARY KEY ("lmsCourseId","scope")
);

-- CreateTable
CREATE TABLE "LmsCourseSeen" (
    "userId" TEXT NOT NULL,
    "lmsCourseId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "fingerprint" TEXT,

    CONSTRAINT "LmsCourseSeen_pkey" PRIMARY KEY ("userId","lmsCourseId","scope")
);

-- CreateIndex
CREATE INDEX "LmsCourseSeen_lmsCourseId_scope_fingerprint_idx" ON "LmsCourseSeen"("lmsCourseId", "scope", "fingerprint");
