/**
 * Every metric instrument the backend emits, created once and shared. Until
 * `tracing.ts` has installed a MeterProvider (prod / opt-in) these are no-op
 * handles, so call sites can record unconditionally.
 *
 * Naming: OTel dot-notation (`http.server.request.duration`); the collector's
 * Prometheus exporter rewrites to `http_server_request_duration_seconds`.
 * Keep label sets low-cardinality — never a userId / sessionId / raw path.
 */
import { metrics, type Attributes } from "@opentelemetry/api";

const meter = metrics.getMeter("zenflow-backend");

// Duration buckets (seconds) for request-style latencies.
const LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30,
];

// --- HTTP ingress (RED) -----------------------------------------------------
export const httpServerDuration = meter.createHistogram(
  "http.server.request.duration",
  {
    unit: "s",
    description: "Inbound HTTP request duration by method + route template",
    advice: { explicitBucketBoundaries: LATENCY_BUCKETS },
  },
);

// --- Outbound clients (RED) ----------------------------------------------------
function outboundHistogram(name: string, who: string) {
  return meter.createHistogram(name, {
    unit: "s",
    description: `Outbound ${who} request duration by operation + status`,
    advice: { explicitBucketBoundaries: LATENCY_BUCKETS },
  });
}
export const portalClientDuration = outboundHistogram(
  "portal.client.request.duration",
  "DLU portal",
);
export const lmsClientDuration = outboundHistogram(
  "lms.client.request.duration",
  "LMS",
);
export const banditClientDuration = outboundHistogram(
  "bandit.client.request.duration",
  "bandit service",
);

// --- Ingestion / watchers ---------------------------------------------------
export const ingestionBlocks = meter.createCounter("ingestion.blocks", {
  description:
    "Materialized upstream blocks by source/type/outcome (unchanged ≈ redundant work)",
});
export const ingestionUpstreamItems = meter.createCounter(
  "ingestion.upstream_items",
  {
    description: "Outbound watcher requests (job items) by operation + status",
  },
);
export const ingestionReconcileDeleted = meter.createCounter(
  "ingestion.reconcile.deleted",
  { description: "Sessions deleted by reconciliation (upstream dropped them)" },
);
export const ingestionLastSuccess = meter.createGauge(
  "ingestion.last_success.timestamp",
  {
    unit: "s",
    description: "Unix seconds of the last fully-successful sync, by provider",
  },
);

// --- Scheduler / bandit ---------------------------------------------------------
export const schedulerProposals = meter.createCounter("scheduler.proposals", {
  description: "SlotProposal rows written, by policy/trigger/series",
});
export const schedulerAppliedPolicy = meter.createCounter(
  "scheduler.applied_policy",
  { description: "Placement outcomes: {assigned} policy vs {applied} policy" },
);
export const schedulerBanditFallback = meter.createCounter(
  "scheduler.bandit.fallback",
  {
    description:
      "LinUCB was assigned but the heuristic placement stood, by reason",
  },
);
export const schedulerArmSelected = meter.createCounter(
  "scheduler.bandit.arm_selected",
  { description: "LinUCB-selected time-of-day arm on applied proposals" },
);
export const schedulerSessionEvents = meter.createCounter(
  "scheduler.session_events",
  { description: "SessionEvent rows written, by type (CREATE/MOVE/RETAINED)" },
);
export const schedulerMoveDragMinutes = meter.createHistogram(
  "scheduler.session.move_drag_minutes",
  {
    unit: "min",
    description: "Absolute drag distance of a user MOVE of a scheduled task",
    advice: {
      explicitBucketBoundaries: [5, 15, 30, 60, 120, 240, 480, 1440],
    },
  },
);
// Placement latency split by the A/B policy (HEURISTIC vs LINUCB). The roll is a coin flip inside
// ExperimentService, so nothing else can attribute a request's latency to a policy.
const PLACEMENT_BUCKETS_S = [
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];
export const schedulerPlacementPythonDuration = meter.createHistogram(
  "scheduler.placement.python.duration",
  {
    unit: "s",
    description:
      "Python /v1/place time by phase (decode|context|predict|scan|displace|total, as the service reports it; http = round trip incl. network), by assigned policy / compute_both / mode",
    advice: { explicitBucketBoundaries: PLACEMENT_BUCKETS_S },
  },
);
export const schedulerPlacementDuration = meter.createHistogram(
  "scheduler.placement.duration",
  {
    unit: "s",
    description:
      "End-to-end single-TASK placement (gather + Python + apply + persist, or the degraded fallback), by assigned/applied policy and source",
    advice: { explicitBucketBoundaries: PLACEMENT_BUCKETS_S },
  },
);
export const schedulerRewardUpdates = meter.createCounter(
  "scheduler.reward_updates",
  { description: "Delayed LinUCB reward updates, by source + result" },
);
export const cronRuns = meter.createCounter("scheduler.cron.runs", {
  description: "Cron / watcher handler runs, by job + result",
});
export const cronDuration = meter.createHistogram("scheduler.cron.duration", {
  unit: "s",
  description: "Cron / watcher handler wall-clock duration, by job",
  advice: {
    explicitBucketBoundaries: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600],
  },
});

// --- Push -----------------------------------------------------------------------
export const pushSend = meter.createCounter("push.send", {
  description: "Native push sends, by provider + result",
});
export const pushDevicesPruned = meter.createCounter("push.devices_pruned", {
  description: "UserDevice rows deleted after a dead-token response",
});

// --- Job queues (queue/, BullMQ) -------------------------------------------------
// Labels: `queue` (portal-fetch | lms-fetch | notify), never a job id or user.
export const queueJobs = meter.createCounter("queue.jobs", {
  description:
    "Queue job outcomes by queue + result (completed|failed|dead_lettered|delayed)",
});
export const queueJobDuration = meter.createHistogram("queue.job.duration", {
  unit: "s",
  description: "Processor wall-clock time of one attempt, by queue + result",
  advice: { explicitBucketBoundaries: LATENCY_BUCKETS },
});
export const queueJobWait = meter.createHistogram("queue.job.wait", {
  unit: "s",
  description:
    "Time from enqueue (or due time) until an attempt started, by queue",
  advice: {
    explicitBucketBoundaries: [0.01, 0.1, 0.5, 1, 5, 30, 60, 300, 900, 3600],
  },
});
export const queueJobAttempts = meter.createHistogram("queue.job.attempts", {
  description: "Attempts a job needed when it finished (ok or dead), by queue",
  advice: { explicitBucketBoundaries: [1, 2, 3, 4, 5, 8, 12] },
});
export const queueEnqueueDropped = meter.createCounter(
  "queue.enqueue.dropped",
  {
    description:
      "Enqueues given up on after retries (queue Redis down), by queue + type; the reconciliation sweep re-enqueues rows it finds without a job",
  },
);
export const queueNotifyReconciled = meter.createCounter(
  "queue.notify.reconciled",
  {
    description:
      "Push jobs re-enqueued by the notification reconciliation sweep (a lost enqueue was repaired)",
  },
);
export const queueDepth = meter.createGauge("queue.depth", {
  description:
    "Jobs per queue + state (waiting|delayed|active|failed|dlq); polled by the watcher",
});

// --- SSE ----------------------------------------------------------------------
export const sseActiveConnections = meter.createUpDownCounter(
  "sse.active_connections",
  { description: "Currently-open /notifications/stream subscriptions" },
);

export const ssePubsubPublished = meter.createCounter("sse.pubsub.published", {
  description: "Notification events published to Redis pub/sub, by result",
});
export const ssePubsubDelivered = meter.createCounter("sse.pubsub.delivered", {
  description: "Pub/sub messages received and re-emitted to local SSE streams",
});
export const ssePubsubSubscribers = meter.createGauge(
  "sse.pubsub.subscribers",
  {
    description: "1 while this process holds its pub/sub subscription, else 0",
  },
);

/** Bucket a raw status code to a low-cardinality class label. */
export function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "1xx";
}

export type MetricAttrs = Attributes;

// --- Python-authoritative placement (ADR-0003) ------------------------------
export const schedulerPlacementSource = meter.createCounter(
  "scheduler.placement_source",
  {
    description:
      "Placements by {source=python|ts_fallback} and degraded {reason}",
  },
);
export const schedulerBreakerState = meter.createGauge(
  "scheduler.breaker_state",
  { description: "Placement circuit breaker: 0 closed, 1 half-open, 2 open" },
);
export const schedulerPlacementShadowMismatch = meter.createCounter(
  "scheduler.placement_shadow_mismatch",
  {
    description:
      "Shadow mode: Python /v1/place disagreed with the legacy TS pick, by kind",
  },
);

// --- Outbound circuit breakers (common/outbound-breaker.ts) -----------------
export const outboundBreakerState = meter.createGauge(
  "outbound.breaker_state",
  {
    description:
      "Outbound circuit breaker by upstream name: 0 closed, 1 half-open, 2 open",
  },
);
export const outboundBreakerShortCircuited = meter.createCounter(
  "outbound.breaker_short_circuited",
  {
    description:
      "Outbound calls refused without a request because the breaker was open, by upstream",
  },
);

// --- Rate limiting ----------------------------------------------------------
export const rateLimitStoreFailOpen = meter.createCounter(
  "rate_limit.store.fail_open",
  {
    description:
      "Requests allowed because the rate-limit store was down/slow, by reason (breaker_open|timeout|error)",
  },
);
