-- Serves `SchedulerService.aggregateTagBias`: newest CREATE/COMPLETE/KEEP
-- events for one user. The existing (userId, occurredAt DESC) index cannot
-- satisfy the eventType filter, so that read scanned and discarded rows.
CREATE INDEX "TaskEvent_userId_eventType_occurredAt_idx"
  ON "TaskEvent"("userId", "eventType", "occurredAt" DESC);
