import type { Job } from "bullmq";
import { DelayedError } from "bullmq";
import {
  UpstreamUnavailableError,
  type OutboundBreakers,
  type RunOptions,
} from "../common/outbound-breaker";
import { queueJobs } from "../observability/metrics";

/**
 * A job may be parked behind an open breaker this many times (without using
 * an attempt) before the unavailability is treated as an ordinary failure.
 * 144 x the 10 min max-open ceiling is about a day.
 */
export const DEFAULT_MAX_BREAKER_DELAYS = 144;

export interface WithBreakerOptions<T> extends RunOptions<T> {
  /** Queue name, for the `queue.jobs` metric label. */
  queue?: string;
  maxDelays?: number;
  /** `() => [0, 1)`; only to make tests deterministic. */
  random?: () => number;
}

/**
 * Run an upstream call for a queue job under the named circuit breaker.
 *
 * - Breaker open: no request is made. The job is moved to delayed for the
 *   breaker's remaining open time (plus up to 10 % jitter) via
 *   `job.moveToDelayed`, then `DelayedError` tells BullMQ the processor has
 *   handled the job. In BullMQ 6 `moveToDelayed` does not consume an attempt.
 * - Any other failure is rethrown unchanged: BullMQ's exponential backoff and
 *   the DLQ handle it (and the breaker counts it, per `options.classify`).
 * - After `maxDelays` consecutive parkings the error is thrown instead, so a
 *   permanently dead upstream still ends in the DLQ.
 *
 * Breaker state is per replica; a job parked by one replica may run on
 * another whose breaker is closed, which is the intended probe behaviour.
 */
export async function withBreaker<T>(
  breakers: OutboundBreakers,
  upstream: string,
  job: Job,
  token: string | undefined,
  fn: () => Promise<T>,
  options: WithBreakerOptions<T> = {},
): Promise<T> {
  try {
    return await breakers.run(upstream, fn, options);
  } catch (err) {
    if (!(err instanceof UpstreamUnavailableError)) throw err;
    return parkBehindBreaker(job, token, err, options);
  }
}

/**
 * Park `job` behind an open breaker: delay it for the breaker's remaining open
 * time (plus jitter) without using an attempt, then throw `DelayedError` for
 * BullMQ. Past `maxDelays` parkings the error itself is thrown, so a dead
 * upstream still ends in the DLQ.
 *
 * Exported for processors whose upstream clients already run each request
 * under the breaker (the DLU portal/LMS clients): wrapping the whole pass in
 * {@link withBreaker} as well would take the half-open probe slot and then
 * refuse the pass's own requests. They catch `UpstreamUnavailableError` and
 * call this instead.
 */
export async function parkBehindBreaker(
  job: Job,
  token: string | undefined,
  err: UpstreamUnavailableError,
  options: Pick<
    WithBreakerOptions<unknown>,
    "queue" | "maxDelays" | "random"
  > = {},
): Promise<never> {
  // `attemptsStarted` counts every start, `attemptsMade` only real attempts;
  // the difference minus the current start is how often it was parked.
  const parked = Math.max(0, job.attemptsStarted - job.attemptsMade - 1);
  if (parked >= (options.maxDelays ?? DEFAULT_MAX_BREAKER_DELAYS)) throw err;
  const random = options.random ?? Math.random;
  const delayMs = Math.ceil(err.retryAfterMs * (1 + random() * 0.1));
  await job.moveToDelayed(Date.now() + delayMs, token);
  queueJobs.add(1, {
    queue: options.queue ?? job.queueName,
    result: "delayed",
  });
  throw new DelayedError(err.message);
}
