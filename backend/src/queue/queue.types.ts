import type { JobsOptions, RateLimiterOptions } from "bullmq";
import { DLQ_SUFFIX } from "./queue.constants";

/**
 * Typed handle for one queue. Create with {@link defineQueue}; the payload
 * type `TData` flows into `QueueService.enqueue` and the processor.
 */
export interface QueueDefinition<TData = unknown> {
  readonly name: string;
  /** Overrides the env-driven defaults (attempts, backoff, retention) for this queue. */
  readonly jobOptions?: JobsOptions;
  /** Default worker rate limit; a consumer may override it when registering. */
  readonly limiter?: RateLimiterOptions;
  /** Jobs processed in parallel by one worker process (default 5). */
  readonly concurrency?: number;
  /** Phantom field carrying the payload type; never set at runtime. */
  readonly __data?: TData;
}

export function defineQueue<TData>(
  def: Omit<QueueDefinition<TData>, "__data">,
): QueueDefinition<TData> {
  if (!/^[a-z0-9_-]+$/i.test(def.name) || def.name.endsWith(DLQ_SUFFIX)) {
    // BullMQ forbids ":" in names; "." is reserved for the ".dlq" suffix.
    throw new Error(`Invalid queue name "${def.name}" (use [a-z0-9_-])`);
  }
  return def;
}

/** Payload stored on the `<name>.dlq` queue for a job that exhausted its attempts. */
export interface DeadLetter<TData = unknown> {
  queue: string;
  jobId: string | undefined;
  jobName: string;
  data: TData;
  failedReason: string;
  attemptsMade: number;
  stacktrace: string[];
  failedAt: string;
}

/**
 * Build a deterministic, BullMQ-safe job id (no ":") from the parts that make
 * one send unique, e.g. `idempotencyKey("push", notificationId)`. A second
 * `enqueue` with the same key is a no-op while the first job still exists.
 */
export function idempotencyKey(
  ...parts: Array<string | number | Date>
): string {
  return parts
    .map((p) => (p instanceof Date ? p.getTime() : String(p)))
    .join("_")
    .replace(/:/g, "-");
}
