import { Logger } from "@nestjs/common";
import {
  Queue,
  QueueEvents,
  UnrecoverableError,
  Worker,
  type Job,
  type Processor,
  type RateLimiterOptions,
} from "bullmq";
import type Redis from "ioredis";
import {
  queueJobAttempts,
  queueJobDuration,
  queueJobs,
  queueJobWait,
} from "../observability/metrics";
import { DLQ_REPLAY_RETENTION, dlqName } from "./queue.constants";
import {
  idempotencyKey,
  type DeadLetter,
  type QueueDefinition,
} from "./queue.types";

const logger = new Logger("QueueWorker");

export interface CreateWorkerOptions<T, R> {
  def: QueueDefinition<T>;
  processor: Processor<T, R>;
  /** Shared queue Redis; BullMQ duplicates it for the blocking connection. */
  connection: Redis;
  /** The `<name>.dlq` queue that receives a job's last failure. */
  dlq: Queue;
  /** Falls back to `def.concurrency`, then 5. */
  concurrency?: number;
  /** Falls back to `def.limiter`; none if neither is set. */
  limiter?: RateLimiterOptions;
  /** See {@link FinalFailureHook}. */
  onFinalFailure?: FinalFailureHook<T>;
  /** BullMQ `maxStalledCount` (default 1); past it a job is failed as stalled. */
  maxStalledCount?: number;
}

/**
 * Runs once a job has failed for good (attempts exhausted, `UnrecoverableError`,
 * or stalled past `maxStalledCount`), after it was copied to the DLQ. Use it
 * to undo state the job held, e.g. release a schedule claim. It may run on
 * every replica that watches the queue for a stalled failure, so make it
 * idempotent; errors are logged and swallowed.
 */
export type FinalFailureHook<T = unknown> = (
  job: Job<T>,
  err: Error,
) => Promise<void> | void;

/** BullMQ's failure reason for a job that exceeded `maxStalledCount`. */
export const STALLED_REASON = /stalled more than allowable limit/i;

/** True once a failed attempt will not be retried. */
export function isFinalFailure(job: Job, err: Error): boolean {
  const attempts = job.opts?.attempts ?? 1;
  return err instanceof UnrecoverableError || job.attemptsMade >= attempts;
}

/**
 * Copy a finally-failed job (payload + error) onto the dead-letter queue. The
 * original stays in the queue's failed set for its retention window. The DLQ
 * id is `<origId>_<finishedOn>`: unique per failure (a job id reused after
 * retention does not collide with an older letter) yet stable for one
 * failure, so a replayed `failed` event or several replicas cannot add twice.
 */
export async function moveToDeadLetter(
  dlq: Queue,
  def: QueueDefinition,
  job: Job,
  err: Error,
): Promise<void> {
  const failedAtMs = job.finishedOn ?? Date.now();
  const letter: DeadLetter = {
    queue: def.name,
    jobId: job.id,
    jobName: job.name,
    data: job.data,
    failedReason: err.message,
    attemptsMade: job.attemptsMade,
    stacktrace: job.stacktrace ?? [],
    failedAt: new Date(failedAtMs).toISOString(),
  };
  await dlq.add(dlqName(def.name), letter, {
    ...(job.id ? { jobId: idempotencyKey(job.id, failedAtMs) } : {}),
    removeOnComplete: { ...DLQ_REPLAY_RETENTION },
    removeOnFail: { ...DLQ_REPLAY_RETENTION },
    attempts: 1,
  });
}

/** DLQ copy, metric and the optional hook for one final failure. */
export async function handleFinalFailure<T>(
  dlq: Queue,
  def: QueueDefinition<T>,
  job: Job<T>,
  err: Error,
  hook?: FinalFailureHook<T>,
): Promise<void> {
  logger.warn(
    `${def.name}/${job.id} dead after ${job.attemptsMade} attempt(s): ${err.message}`,
  );
  try {
    await moveToDeadLetter(dlq, def, job as Job, err);
    queueJobs.add(1, { queue: def.name, result: "dead_lettered" });
  } catch (e) {
    logger.error(
      `${def.name}/${job.id} DLQ write failed: ${(e as Error).message}`,
    );
  }
  try {
    await hook?.(job, err);
  } catch (e) {
    logger.error(
      `${def.name}/${job.id} onFinalFailure failed: ${(e as Error).message}`,
    );
  }
}

/**
 * BullMQ's worker never emits `failed` for a job it fails as stalled (the
 * Lua stalled check does it), so listen on the queue's event stream and run
 * the same final-failure path. Needs its own blocking connection; close the
 * returned `QueueEvents` with the worker.
 */
export function watchStalledFailures<T>(opts: {
  def: QueueDefinition<T>;
  connection: Redis;
  queue: Queue;
  dlq: Queue;
  onFinalFailure?: FinalFailureHook<T>;
}): QueueEvents {
  const { def } = opts;
  const events = new QueueEvents(def.name, {
    connection: opts.connection.duplicate(),
  });
  events.on("failed", ({ jobId, failedReason }) => {
    if (!STALLED_REASON.test(failedReason ?? "")) return;
    void (async () => {
      const job = (await opts.queue.getJob(jobId)) as Job<T> | undefined;
      if (!job) return;
      queueJobs.add(1, { queue: def.name, result: "failed" });
      await handleFinalFailure(
        opts.dlq,
        def,
        job,
        new Error(failedReason),
        opts.onFinalFailure,
      );
    })().catch((e: Error) =>
      logger.error(
        `${def.name}/${jobId} stalled handling failed: ${e.message}`,
      ),
    );
  });
  events.on("error", (err) =>
    logger.warn(`events ${def.name}: ${err.message}`),
  );
  return events;
}

/**
 * A BullMQ `Worker` for `def` with the shared behaviour:
 *  - concurrency + rate limiter (queue defaults, overridable);
 *  - metrics: outcome counter, attempt duration, wait time, attempts needed;
 *  - on the final failure the job is copied to `<name>.dlq` (and counted),
 *    then `onFinalFailure` runs; stalled failures need {@link watchStalledFailures}.
 *
 * The processor decides retry semantics: throw for exponential backoff, or use
 * {@link withBreaker} to park behind an open breaker without using an attempt.
 * Close it with `worker.close()` (waits for in-flight jobs); `QueueWorkers`
 * does so on shutdown.
 */
export function createWorker<T, R = unknown>(
  opts: CreateWorkerOptions<T, R>,
): Worker<T, R> {
  const { def, dlq } = opts;
  const limiter = opts.limiter ?? def.limiter;
  const worker = new Worker<T, R>(def.name, opts.processor, {
    connection: opts.connection,
    concurrency: opts.concurrency ?? def.concurrency ?? 5,
    ...(limiter ? { limiter } : {}),
    ...(opts.maxStalledCount !== undefined
      ? { maxStalledCount: opts.maxStalledCount }
      : {}),
  });

  worker.on("active", (job) => {
    if (job.processedOn) {
      queueJobWait.record(Math.max(0, job.processedOn - job.timestamp) / 1000, {
        queue: def.name,
      });
    }
  });

  worker.on("completed", (job) => {
    queueJobs.add(1, { queue: def.name, result: "completed" });
    recordDuration(def.name, job, "completed");
    queueJobAttempts.record(job.attemptsMade, { queue: def.name });
  });

  worker.on("failed", (job, err) => {
    if (!job) return; // stalled failures arrive via watchStalledFailures
    queueJobs.add(1, { queue: def.name, result: "failed" });
    recordDuration(def.name, job, "failed");
    if (!isFinalFailure(job, err)) return;
    queueJobAttempts.record(job.attemptsMade, { queue: def.name });
    void handleFinalFailure(dlq, def, job, err, opts.onFinalFailure);
  });

  worker.on("error", (err) =>
    logger.warn(`worker ${def.name}: ${err.message}`),
  );
  return worker;
}

function recordDuration(queue: string, job: Job, result: string): void {
  if (job.processedOn) {
    queueJobDuration.record((Date.now() - job.processedOn) / 1000, {
      queue,
      result,
    });
  }
}
