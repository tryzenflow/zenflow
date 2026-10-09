import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueueWorkers, queueEnvKey } from "../queue/queue-workers.service";
import {
  LMS_FETCH_QUEUE,
  PORTAL_FETCH_QUEUE,
  type FetchJobData,
} from "../queue/queues";
import type { QueueDefinition } from "../queue/queue.types";
import { IngestionFetchService } from "./ingestion-fetch.service";

/**
 * Concurrency defaults to 1 per replica (one request stream per worker, tunable
 * with `QUEUE_<X>_CONCURRENCY`); the per-request delay lives in the watchers. Replicas are NOT sequential with each other, so
 * unless `QUEUE_<X>_RATE_MAX` is set the queue gets a default limiter: one job
 * start per `INGESTION_REQUEST_DELAY_MS` across all replicas (none when the
 * delay is 0). A start is a whole pass, so this spaces logins and bursts; it
 * does not serialise the passes themselves.
 */
export function defaultFetchLimiter(
  config: ConfigService,
  def: QueueDefinition<FetchJobData>,
): { max: number; duration: number } | undefined {
  if (Number(config.get(`QUEUE_${queueEnvKey(def.name)}_RATE_MAX`)) > 0) {
    return undefined; // explicit env wins (applied by QueueWorkers)
  }
  const delay = Number(config.get("INGESTION_REQUEST_DELAY_MS") ?? 750);
  return Number.isFinite(delay) && delay > 0
    ? { max: 1, duration: delay }
    : undefined;
}

function register(
  workers: QueueWorkers,
  fetch: IngestionFetchService,
  config: ConfigService,
  def: QueueDefinition<FetchJobData>,
): void {
  workers.register(def, (job, token) => fetch.handle(job, token), {
    limiter: defaultFetchLimiter(config, def),
    onFinalFailure: (job, err) => fetch.onFinalFailure(job, err),
  });
}

/** Consumer of `portal-fetch` (roles `worker-portal`, `worker`, `all`). */
@Injectable()
export class PortalFetchProcessor implements OnModuleInit {
  constructor(
    private readonly workers: QueueWorkers,
    private readonly fetch: IngestionFetchService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    register(this.workers, this.fetch, this.config, PORTAL_FETCH_QUEUE);
  }
}

/** Consumer of `lms-fetch` (roles `worker-lms`, `worker`, `all`). */
@Injectable()
export class LmsFetchProcessor implements OnModuleInit {
  constructor(
    private readonly workers: QueueWorkers,
    private readonly fetch: IngestionFetchService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    register(this.workers, this.fetch, this.config, LMS_FETCH_QUEUE);
  }
}
