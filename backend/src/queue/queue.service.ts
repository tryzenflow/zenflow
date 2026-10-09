import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, type Job, type JobsOptions } from "bullmq";
import type Redis from "ioredis";
import {
  COMPLETED_RETENTION,
  FAILED_RETENTION,
  QUEUE_REDIS,
  dlqName,
} from "./queue.constants";
import type { QueueDefinition } from "./queue.types";

export interface EnqueueOptions {
  /**
   * Idempotency key (see `idempotencyKey()`): becomes the BullMQ job id, so an
   * identical enqueue while the job still exists is a no-op.
   */
  jobId: string;
  /** Run no earlier than this many ms from now (delayed job). */
  delayMs?: number;
  /** Per-call overrides of the queue's job options (priority, attempts, ...). */
  jobOptions?: JobsOptions;
}

export interface QueueCounts {
  waiting: number;
  delayed: number;
  active: number;
  failed: number;
  dlq: number;
}

/** A job as kept by the in-memory fallback (see {@link QueueService.memory}). */
export interface MemoryJob {
  queue: string;
  id: string;
  data: unknown;
  opts: JobsOptions;
}

const DEFAULT_ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Producer side of every queue. One cached `Queue` (plus its dead-letter
 * `Queue`) per {@link QueueDefinition}, all on the shared queue Redis.
 *
 * Test fallback: with `NODE_ENV=test` and no `QUEUE_REDIS_URL` the module
 * provides no connection ({@link memory} is true). `enqueue` then only records
 * the job in {@link memoryJobs} (deduplicated by `jobId`, like Redis) and no
 * worker consumes it, so suites need no Redis.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();
  /** Jobs recorded in memory mode, in enqueue order. */
  readonly memoryJobs: MemoryJob[] = [];

  constructor(
    @Inject(QUEUE_REDIS) private readonly connection: Redis | null,
    private readonly config: ConfigService,
  ) {}

  /** True when there is no Redis behind this service (test fallback). */
  get memory(): boolean {
    return this.connection === null;
  }

  /** The BullMQ queue behind `def` (created on first use). */
  queue<T>(def: QueueDefinition<T>): Queue<T> {
    return this.open(def.name) as Queue<T>;
  }

  /** The `<name>.dlq` queue of `def`. */
  dlq(def: QueueDefinition): Queue {
    return this.open(dlqName(def.name));
  }

  /**
   * Add one job. Resolves to the job (new, or the existing one when `jobId`
   * was already enqueued). Bounded: rejects after `QUEUE_ENQUEUE_TIMEOUT_MS`
   * when the queue Redis is unreachable (the shared connection retries
   * forever for the workers' sake, so the timeout is what keeps producers
   * from hanging); callers decide whether that is fatal.
   */
  enqueue<T>(
    def: QueueDefinition<T>,
    data: T,
    opts: EnqueueOptions,
  ): Promise<Job<T>> {
    const jobOptions: JobsOptions = {
      ...this.defaultJobOptions(),
      ...def.jobOptions,
      ...opts.jobOptions,
      jobId: opts.jobId,
      ...(opts.delayMs !== undefined && opts.delayMs > 0
        ? { delay: Math.round(opts.delayMs) }
        : {}),
    };
    if (this.memory)
      return Promise.resolve(this.recordInMemory(def, data, jobOptions));
    // BullMQ's generic job-name/result types are not worth threading through.
    return this.bounded(
      `enqueue ${def.name}/${opts.jobId}`,
      (this.queue(def) as unknown as Queue).add(
        def.name,
        data,
        jobOptions,
      ) as Promise<Job<T>>,
    );
  }

  /**
   * Look a job up by id (any state); `undefined` if it does not exist
   * (never enqueued, or evicted by retention). Bounded like {@link enqueue}.
   */
  async getJob<T>(
    def: QueueDefinition<T>,
    jobId: string,
  ): Promise<Job<T> | undefined> {
    if (this.memory) {
      const j = this.memoryJobs.find(
        (m) => m.queue === def.name && m.id === jobId,
      );
      return j
        ? ({ id: j.id, name: def.name, data: j.data, opts: j.opts } as Job<T>)
        : undefined;
    }
    return this.bounded(
      `getJob ${def.name}/${jobId}`,
      this.queue(def).getJob(jobId),
    ) as Promise<Job<T> | undefined>;
  }

  /**
   * Delete DLQ entries older than `maxAgeMs` (at most `limit` per call). The
   * DLQ has no consumer, so BullMQ's own retention never applies to it.
   */
  async trimDlq(
    def: QueueDefinition,
    maxAgeMs: number,
    limit = 1_000,
  ): Promise<number> {
    if (this.memory) return 0;
    const removed = await this.bounded(
      `trimDlq ${def.name}`,
      this.dlq(def).clean(maxAgeMs, limit, "wait"),
    );
    return removed.length;
  }

  /** Race `op` against `QUEUE_ENQUEUE_TIMEOUT_MS` so a Redis outage rejects fast. */
  private async bounded<R>(label: string, op: Promise<R>): Promise<R> {
    const timeoutMs =
      this.config.get<number>("QUEUE_ENQUEUE_TIMEOUT_MS") ??
      DEFAULT_ENQUEUE_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    // The loser of the race must not surface as an unhandled rejection.
    op.catch(() => undefined);
    try {
      return await Promise.race([
        op,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * {@link enqueue} that never throws or hangs: for callers that must not fail
   * their own request when the queue Redis is down (the API after a DB write).
   * Resolves to `null` on timeout (`QUEUE_ENQUEUE_TIMEOUT_MS`) or error; the
   * caller's sweep or retry is the safety net. Same bound as {@link enqueue}.
   */
  async enqueueBestEffort<T>(
    def: QueueDefinition<T>,
    data: T,
    opts: EnqueueOptions,
  ): Promise<Job<T> | null> {
    try {
      return await this.enqueue(def, data, opts);
    } catch (err) {
      this.logger.warn(
        `enqueue ${def.name}/${opts.jobId} failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Remove a not-yet-active job (e.g. a cancelled reminder); false if absent or running. */
  async remove(def: QueueDefinition, jobId: string): Promise<boolean> {
    if (this.memory) {
      const i = this.memoryJobs.findIndex(
        (j) => j.queue === def.name && j.id === jobId,
      );
      if (i >= 0) this.memoryJobs.splice(i, 1);
      return i >= 0;
    }
    try {
      return (
        (await this.bounded(
          `remove ${def.name}/${jobId}`,
          this.queue(def).remove(jobId),
        )) > 0
      );
    } catch (err) {
      this.logger.debug(
        `remove ${def.name}/${jobId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  async counts(def: QueueDefinition): Promise<QueueCounts> {
    if (this.memory) {
      const waiting = this.memoryJobs.filter(
        (j) => j.queue === def.name,
      ).length;
      return { waiting, delayed: 0, active: 0, failed: 0, dlq: 0 };
    }
    const [main, dead] = await this.bounded(
      `counts ${def.name}`,
      Promise.all([
        this.queue(def).getJobCounts("waiting", "delayed", "active", "failed"),
        this.dlq(def).getJobCounts("waiting"),
      ]),
    );
    return {
      waiting: main.waiting ?? 0,
      delayed: main.delayed ?? 0,
      active: main.active ?? 0,
      failed: main.failed ?? 0,
      dlq: dead.waiting ?? 0,
    };
  }

  /** Env-driven defaults: attempts + exponential backoff + retention. */
  defaultJobOptions(): JobsOptions {
    return {
      attempts: this.config.get<number>("QUEUE_JOB_ATTEMPTS") ?? 5,
      backoff: {
        type: "exponential",
        delay: this.config.get<number>("QUEUE_BACKOFF_MS") ?? 5_000,
      },
      removeOnComplete: { ...COMPLETED_RETENTION },
      removeOnFail: { ...FAILED_RETENTION },
    };
  }

  private recordInMemory<T>(
    def: QueueDefinition<T>,
    data: T,
    opts: JobsOptions,
  ): Job<T> {
    const id = opts.jobId as string;
    const existing = this.memoryJobs.find(
      (j) => j.queue === def.name && j.id === id,
    );
    const job = existing ?? { queue: def.name, id, data, opts };
    if (!existing) this.memoryJobs.push(job);
    return { id, name: def.name, data: job.data, opts: job.opts } as Job<T>;
  }

  private open(name: string): Queue {
    if (!this.connection) throw new Error("queue Redis is not configured");
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      q.on("error", (err) => this.logger.warn(`queue ${name}: ${err.message}`));
      this.queues.set(name, q);
    }
    return q;
  }

  /**
   * Runs after every `onModuleDestroy`, i.e. after `QueueWorkers` has drained
   * its workers, so the shared connection outlives in-flight jobs.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.connection?.disconnect();
  }
}
