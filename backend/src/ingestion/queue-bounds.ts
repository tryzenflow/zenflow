import type { ConfigService } from "@nestjs/config";

/** Fallback for `QUEUE_ENQUEUE_TIMEOUT_MS`, matching `QueueService`. */
const DEFAULT_QUEUE_CALL_TIMEOUT_MS = 2_000;

/**
 * The queue Redis could not be reached in time. Ingestion callers treat it as
 * "try again later": the ticker hands its claims back, manual sync answers 503.
 */
export class QueueUnavailableError extends Error {
  constructor(label: string, cause?: unknown) {
    super(
      `queue unavailable (${label})${cause instanceof Error ? `: ${cause.message}` : ""}`,
    );
    this.name = "QueueUnavailableError";
  }
}

/** Per-call bound for queue operations, from `QUEUE_ENQUEUE_TIMEOUT_MS`. */
export function queueCallTimeoutMs(config: ConfigService): number {
  const v = Number(config.get("QUEUE_ENQUEUE_TIMEOUT_MS"));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_QUEUE_CALL_TIMEOUT_MS;
}

/**
 * Bound a call on a BullMQ `Job` or `QueueEvents` (the `QueueService` methods bound themselves). BullMQ buffers commands while Redis is down, so an
 * unbounded call can hang the ticker or an API request; this makes it reject
 * with {@link QueueUnavailableError} instead. Belt and braces with the bound
 * `QueueService` applies itself.
 */
export async function boundedQueueCall<T>(
  config: ConfigService,
  label: string,
  call: () => Promise<T>,
): Promise<T> {
  const ms = queueCallTimeoutMs(config);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new QueueUnavailableError(`${label} timed out ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } catch (err) {
    throw err instanceof QueueUnavailableError
      ? err
      : new QueueUnavailableError(label, err);
  } finally {
    clearTimeout(timer);
  }
}
