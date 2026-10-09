import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job, QueueEvents, RateLimiterOptions, Worker } from "bullmq";
import type Redis from "ioredis";
import {
  createWorker,
  watchStalledFailures,
  type FinalFailureHook,
} from "./create-worker";
import { QUEUE_REDIS } from "./queue.constants";
import type { QueueDefinition } from "./queue.types";
import { QueueService } from "./queue.service";

/** Drain budget; keep below the orchestrator's stop grace period. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export interface RegisterOptions<T = unknown> {
  concurrency?: number;
  limiter?: RateLimiterOptions;
  /**
   * Runs after a job failed for good and reached the DLQ (attempts used up,
   * unrecoverable, or stalled past the limit). E.g. ingestion releases the
   * schedule claim here so the row is not stuck until the claim lease expires.
   * Idempotent please: stalled failures can fire on several replicas.
   */
  onFinalFailure?: FinalFailureHook<T>;
}

export type JobProcessor<T, R> = (job: Job<T, R>, token?: string) => Promise<R>;

/** `portal-fetch` -> `PORTAL_FETCH`, the middle of the `QUEUE_<X>_*` env keys. */
export const queueEnvKey = (name: string): string =>
  name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/**
 * Consumer side: registers one processor per queue in this process and closes
 * the workers gracefully on shutdown (enable shutdown hooks; `main.ts` does).
 *
 * Per-queue tuning from env, each falling back to the queue definition:
 * `QUEUE_<X>_CONCURRENCY`, and `QUEUE_<X>_RATE_MAX` with
 * `QUEUE_<X>_RATE_DURATION_MS` (at most MAX jobs per DURATION across all
 * replicas, since BullMQ's limiter lives in Redis).
 */
@Injectable()
export class QueueWorkers implements BeforeApplicationShutdown {
  private readonly logger = new Logger(QueueWorkers.name);
  private readonly workers: Worker[] = [];
  private readonly events: QueueEvents[] = [];

  constructor(
    @Inject(QUEUE_REDIS) private readonly connection: Redis | null,
    private readonly queues: QueueService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Start consuming `def`. Returns `null` (and consumes nothing) when there is
   * no queue Redis (test fallback).
   */
  register<T, R = unknown>(
    def: QueueDefinition<T>,
    processor: JobProcessor<T, R>,
    opts: RegisterOptions<T> = {},
  ): Worker<T, R> | null {
    if (!this.connection) {
      this.logger.debug(`${def.name}: no queue Redis, worker not started`);
      return null;
    }
    const key = queueEnvKey(def.name);
    const num = (suffix: string): number | undefined => {
      const v = Number(this.config.get(`QUEUE_${key}_${suffix}`));
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    const rateMax = num("RATE_MAX");
    const limiter =
      opts.limiter ??
      (rateMax
        ? { max: rateMax, duration: num("RATE_DURATION_MS") ?? 1_000 }
        : undefined);
    const worker = createWorker<T, R>({
      def,
      processor,
      connection: this.connection,
      dlq: this.queues.dlq(def),
      concurrency: opts.concurrency ?? num("CONCURRENCY"),
      limiter,
      onFinalFailure: opts.onFinalFailure,
    });
    this.events.push(
      watchStalledFailures<T>({
        def,
        connection: this.connection,
        queue: this.queues.queue(def),
        dlq: this.queues.dlq(def),
        onFinalFailure: opts.onFinalFailure,
      }),
    );
    this.workers.push(worker as Worker);
    this.logger.log(`consuming ${def.name}`);
    return worker;
  }

  /**
   * Drain in-flight jobs before Prisma, Redis, pub/sub and the push senders
   * close. They all close in `onApplicationShutdown`, which runs after
   * `beforeApplicationShutdown` (unlike `onModuleDestroy`, which runs first). Waits up to
   * `QUEUE_SHUTDOWN_TIMEOUT_MS`, then force-closes; an interrupted job is
   * retried via the stalled check.
   */
  async beforeApplicationShutdown(): Promise<void> {
    const budget =
      this.config.get<number>("QUEUE_SHUTDOWN_TIMEOUT_MS") ??
      DEFAULT_SHUTDOWN_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const forced = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), budget);
    });
    const graceful = Promise.allSettled(this.workers.map((w) => w.close()));
    const outcome = await Promise.race([graceful, forced]);
    clearTimeout(timer);
    if (outcome === "timeout") {
      this.logger.warn(
        `workers did not drain in ${budget}ms, closing forcefully`,
      );
      await Promise.allSettled(this.workers.map((w) => w.close(true)));
    }
    await Promise.allSettled(this.events.map((e) => e.close()));
  }
}
