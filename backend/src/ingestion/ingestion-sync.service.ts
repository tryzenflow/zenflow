import { KillSwitchService } from "../common/killswitch/killswitch.service";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueueEvents, type Job } from "bullmq";
import type Redis from "ioredis";
import type { IntegrationProvider } from "@zenflow/shared";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_REDIS } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import {
  LMS_FETCH_QUEUE,
  PORTAL_FETCH_QUEUE,
  type FetchJobData,
} from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";
import {
  IngestionFetchService,
  type FetchResult,
} from "./ingestion-fetch.service";
import { boundedQueueCall } from "./queue-bounds";
import { isIngestionEnabled, positiveConfig } from "./watcher-support";

/** How often a waiting manual sync checks whether its job was parked. */
const PARK_POLL_MS = 1_000;
/** Retry-After when the queue itself is unreachable. */
const QUEUE_RETRY_AFTER_MS = 30_000;

/**
 * A manual sync that cannot make progress now: its job was parked behind an
 * open upstream breaker (seen in the workers, not the API), or the queue Redis
 * is unreachable. The caller answers 503 + Retry-After instead of waiting out
 * `SYNC_MANUAL_WAIT_MS`. A parked job stays queued and runs on its own.
 */
export class ManualSyncUnavailableError extends Error {
  constructor(
    readonly reason: "upstream" | "queue",
    readonly retryAfterMs: number,
  ) {
    super(
      reason === "upstream"
        ? `manual sync parked behind an open upstream breaker (~${Math.ceil(retryAfterMs / 1000)}s)`
        : "manual sync unavailable: queue unreachable",
    );
    this.name = "ManualSyncUnavailableError";
  }
}

/** Ms until a parked (delayed) job runs again, from what `moveToDelayed` stored. */
function parkedRetryAfterMs(job: Pick<Job, "delay" | "processedOn">): number {
  const delay = Number(job.delay);
  const parkedAt = job.processedOn ?? Date.now();
  const left = delay - (Date.now() - parkedAt);
  return Number.isFinite(left) && left > 0 ? Math.ceil(left) : 1_000;
}

/** How long a manual sync waits for its jobs before answering 202. */
const DEFAULT_WAIT_MS = 25_000;

/**
 * What a manual run did. `complete` is false when any pass failed - including
 * one that never got a token - even if another pass succeeded, so a healthy
 * exam call cannot mask a portal login that did not work. `pending` is true
 * when no pass failed but at least one had not finished when the wait ended;
 * the jobs carry on in the background.
 */
export interface ManualSyncOutcome {
  synced: SyncedKind[];
  complete: boolean;
  pending: boolean;
}

/** Schedule kinds, as `IngestionScheduleService.deferAfterManualSync` takes them. */
export type SyncedKind =
  | "PORTAL_DISCOVERY"
  | "PORTAL_TIMETABLE"
  | "PORTAL_EXAM"
  | "LMS_CALENDAR";

type PassState = "ok" | "failed" | "pending";

const KINDS_BY_PROVIDER: Record<IntegrationProvider, SyncedKind[]> = {
  // Timetable first: a clean pass implies discovery covered the term.
  PORTAL: ["PORTAL_TIMETABLE", "PORTAL_EXAM"],
  LMS: ["LMS_CALENDAR"],
};

/**
 * The manual `POST /integrations/:provider/sync` trigger, in one place.
 *
 * It enqueues the *same* fetch jobs the ticker does (`portal-fetch` /
 * `lms-fetch`, one per kind, narrowed to one student) and waits for them, so
 * there is no second, "manual" code path that could drift from the background
 * sweep, and the upstream work still runs in the fetch workers under the
 * breaker and the politeness limits. Schedule bookkeeping (deferral on
 * success, failure count) is done by the job itself, so it happens even when
 * the caller stopped waiting.
 *
 * Without a queue Redis (the in-memory test fallback) the passes run inline,
 * one after the other.
 *
 * Existing to keep the unavoidable `IntegrationsModule` <-> `IngestionModule`
 * cycle down to a single `forwardRef` seam.
 */
@Injectable()
export class IngestionSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(IngestionSyncService.name);
  private readonly events = new Map<string, QueueEvents>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
    private readonly fetch: IngestionFetchService,
    @Inject(QUEUE_REDIS) private readonly redis: Redis | null,
    private readonly lmsClient: LMSService,
    private readonly portalClient: PortalAPIService,
    private readonly killSwitch: KillSwitchService,
  ) {}

  /**
   * Ms until `provider`'s upstream circuit breaker may admit a call, or `null`
   * when it can. A non-consuming peek, used to refuse a manual sync up front.
   */
  upstreamUnavailableFor(provider: IntegrationProvider): number | null {
    return provider === "LMS"
      ? this.lmsClient.unavailableFor()
      : this.portalClient.unavailableFor();
  }

  /**
   * Enqueue one student's passes for `provider` and wait up to
   * `SYNC_MANUAL_WAIT_MS` (default 25 s) for them, so the caller can read back
   * a `lastSyncStatus` that reflects this run.
   *
   * Sibling portal passes (timetable, exam) are queued together; the queue's
   * concurrency of 1 per replica keeps their requests sequential.
   *
   * Throws {@link ManualSyncUnavailableError} when the queue is unreachable or
   * a job was parked behind an open upstream breaker.
   */
  async syncNow(
    userId: string,
    provider: IntegrationProvider,
    now = new Date(),
  ): Promise<ManualSyncOutcome> {
    const failed: ManualSyncOutcome = {
      synced: [],
      complete: false,
      pending: false,
    };
    if (
      !isIngestionEnabled(this.config) ||
      !(await this.killSwitch.isEnabled("ingestion"))
    ) {
      return failed;
    }
    const integration = await this.prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { id: true },
    });
    if (!integration) return failed;

    const jobs: FetchJobData[] = KINDS_BY_PROVIDER[provider].map((kind) => ({
      scheduleId: "",
      userId,
      integrationId: integration.id,
      kind,
      dueAt: now.toISOString(),
      manual: true,
    }));

    const states = this.queue.memory
      ? await this.runInline(jobs)
      : await this.runQueued(provider, jobs);

    const synced: SyncedKind[] = [];
    jobs.forEach((job, i) => {
      if (states[i] !== "ok") return;
      if (job.kind === "PORTAL_TIMETABLE") synced.push("PORTAL_DISCOVERY");
      synced.push(job.kind as SyncedKind);
    });
    const anyFailed = states.includes("failed");
    return {
      synced,
      complete: states.every((s) => s === "ok"),
      pending: !anyFailed && states.includes("pending"),
    };
  }

  private async runInline(jobs: FetchJobData[]): Promise<PassState[]> {
    const states: PassState[] = [];
    for (const data of jobs) {
      try {
        const result = await this.fetch.execute(data);
        states.push(result.ok ? "ok" : "failed");
      } catch (err) {
        await this.fetch.recordExhausted(data, err, {
          attemptsMade: 0,
          opts: { attempts: 1 },
        });
        states.push("failed");
      }
    }
    return states;
  }

  private async runQueued(
    provider: IntegrationProvider,
    datas: FetchJobData[],
  ): Promise<PassState[]> {
    const def = provider === "LMS" ? LMS_FETCH_QUEUE : PORTAL_FETCH_QUEUE;
    const waitMs = positiveConfig(
      this.config,
      "SYNC_MANUAL_WAIT_MS",
      DEFAULT_WAIT_MS,
    );
    const deadline = Date.now() + waitMs;
    const jobs: Job<FetchJobData>[] = [];
    let events: QueueEvents;
    // Every queue call is bounded: with the queue Redis down this fails fast
    // (503) instead of hanging past the wait.
    try {
      events = await boundedQueueCall(this.config, "events", () =>
        this.eventsFor(def.name),
      );
      for (const data of datas) {
        // One manual job per integration and kind: a repeat while it is still
        // queued or running joins it; a finished one is replaced.
        const jobId = idempotencyKey("manual", data.integrationId, data.kind);
        const existing = await this.queue.getJob(def, jobId);
        if (existing) {
          const state = await boundedQueueCall(this.config, "getState", () =>
            existing.getState(),
          );
          // Still parked from an earlier press: the upstream is down, say so.
          if (state === "delayed") {
            throw new ManualSyncUnavailableError(
              "upstream",
              parkedRetryAfterMs(existing),
            );
          }
          if (state === "completed" || state === "failed") {
            await boundedQueueCall(this.config, "remove", () =>
              existing.remove(),
            ).catch(() => undefined);
          }
        }
        jobs.push(
          await this.queue.enqueue(def, data, {
            jobId,
            jobOptions: { attempts: 1 },
          }),
        );
      }
    } catch (err) {
      if (err instanceof ManualSyncUnavailableError) throw err;
      // QueueService calls reject quickly when the queue Redis is down.
      throw new ManualSyncUnavailableError("queue", QUEUE_RETRY_AFTER_MS);
    }
    return Promise.all(
      jobs.map((job) => this.settle(job, events, deadline - Date.now())),
    );
  }

  /**
   * Wait for one job; a wait that expires is `pending` unless it failed. A job
   * the worker parked behind an open breaker (state `delayed`) ends the wait
   * early with {@link ManualSyncUnavailableError}.
   */
  private async settle(
    job: Job<FetchJobData>,
    events: QueueEvents,
    ttlMs: number,
  ): Promise<PassState> {
    let timer: NodeJS.Timeout | undefined;
    const parked = new Promise<never>((_, reject) => {
      timer = setInterval(() => {
        boundedQueueCall(this.config, "getState", () => job.getState())
          .then((state) => {
            if (state === "delayed") {
              reject(
                new ManualSyncUnavailableError(
                  "upstream",
                  parkedRetryAfterMs(job),
                ),
              );
            }
          })
          .catch(() => undefined);
      }, PARK_POLL_MS);
    });
    try {
      const result = (await Promise.race([
        job.waitUntilFinished(events, Math.max(1, ttlMs)),
        parked,
      ])) as FetchResult | undefined;
      return result?.ok ? "ok" : "failed";
    } catch (err) {
      if (err instanceof ManualSyncUnavailableError) throw err;
      try {
        const state = await boundedQueueCall(this.config, "getState", () =>
          job.getState(),
        );
        return state === "failed" ? "failed" : "pending";
      } catch (stateErr) {
        this.logger.debug(
          `manual sync state unknown: ${(stateErr as Error).message}`,
        );
        return "pending";
      }
    } finally {
      clearInterval(timer);
    }
  }

  private async eventsFor(name: string): Promise<QueueEvents> {
    let events = this.events.get(name);
    if (!events) {
      events = new QueueEvents(name, { connection: this.redis! });
      events.on("error", (err) =>
        this.logger.warn(`queue events ${name}: ${err.message}`),
      );
      this.events.set(name, events);
    }
    await events.waitUntilReady();
    return events;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.events.values()].map((e) => e.close()));
  }
}
