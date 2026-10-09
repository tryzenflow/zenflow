-- Issue #139 / ADR-0016: range-partition "SessionEvent" by month on "occurredAt".
-- Hand-written: Prisma has no native partitioning. The table is empty before
-- launch, so it is dropped and recreated rather than converted. The primary key
-- becomes ("id", "occurredAt") because a partitioned table's unique keys must
-- include the partition key. Monthly children are named "SessionEvent_YYYY_MM";
-- the worker (SessionEventPartitionService) keeps the next two months created
-- and drops those older than 12 months.

DROP TABLE "SessionEvent";

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventType" "SessionEventType" NOT NULL,
    "oldSnapshot" JSONB,
    "newSnapshot" JSONB NOT NULL,
    "rewardScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "dragDistanceMinutes" INTEGER,
    "policy" "SchedulingModel",
    "seriesId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,
    "slotProposalId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id", "occurredAt")
) PARTITION BY RANGE ("occurredAt");

-- Bootstrap partitions so inserts work before the first worker run.
CREATE TABLE "SessionEvent_2026_10" PARTITION OF "SessionEvent" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "SessionEvent_2026_11" PARTITION OF "SessionEvent" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "SessionEvent_2026_12" PARTITION OF "SessionEvent" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- CreateIndex
CREATE INDEX "SessionEvent_userId_occurredAt_idx" ON "SessionEvent"("userId", "occurredAt" DESC);
CREATE INDEX "SessionEvent_sessionId_idx" ON "SessionEvent"("sessionId");
CREATE INDEX "SessionEvent_slotProposalId_idx" ON "SessionEvent"("slotProposalId");
CREATE INDEX "SessionEvent_seriesId_idx" ON "SessionEvent"("seriesId");

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_slotProposalId_fkey" FOREIGN KEY ("slotProposalId") REFERENCES "SlotProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
