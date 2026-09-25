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

// --- SSE ----------------------------------------------------------------------
export const sseActiveConnections = meter.createUpDownCounter(
  "sse.active_connections",
  { description: "Currently-open /notifications/stream subscriptions" },
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
