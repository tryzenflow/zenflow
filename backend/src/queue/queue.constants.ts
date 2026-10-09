/** DI token for the `ioredis` client on the dedicated durable queue Redis (`QUEUE_REDIS_URL`). */
export const QUEUE_REDIS = Symbol("QUEUE_REDIS");

/** Suffix of the dead-letter queue that belongs to a queue: `<name>.dlq`. */
export const DLQ_SUFFIX = ".dlq";

export const dlqName = (queueName: string): string =>
  `${queueName}${DLQ_SUFFIX}`;

const DAY_S = 24 * 60 * 60;

/**
 * Retention for finished jobs. Kept long enough that a re-enqueue of the same
 * `jobId` (a retry of a producer, a restart, a deploy overlap) is still
 * deduplicated: BullMQ ignores an `add` whose id still exists.
 */
export const COMPLETED_RETENTION = { age: DAY_S, count: 5_000 } as const;
export const FAILED_RETENTION = { age: 7 * DAY_S, count: 5_000 } as const;

/**
 * Dead letters have no consumer, so they sit in `waiting`; the watcher's
 * metrics poll deletes entries older than this (`QueueService.trimDlq`).
 * The retention options on the DLQ job itself only matter if one is replayed.
 */
export const DLQ_MAX_AGE_MS = 30 * DAY_S * 1000;
export const DLQ_REPLAY_RETENTION = { age: 7 * DAY_S, count: 1_000 } as const;
