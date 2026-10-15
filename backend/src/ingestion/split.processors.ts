import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueueWorkers } from "../queue/queue-workers.service";
import {
  LMS_DISCOVERY_QUEUE,
  LMS_MONTH_QUEUE,
  PORTAL_DISCOVERY_QUEUE,
  PORTAL_MARKS_QUEUE,
  PORTAL_PROFILE_QUEUE,
  PORTAL_WEEK_QUEUE,
} from "../queue/queues";
import { defaultFetchLimiter } from "./fetch.processor";
import { SplitJobsService } from "./split-jobs.service";

/**
 * Consumers of the split portal queues (roles `worker-portal`, `worker`,
 * `all`). Each queue is its own worker so a slow marks fetch never sits in
 * front of a timetable week. Concurrency is 1 per replica and every job start
 * is spaced by `INGESTION_REQUEST_DELAY_MS` across replicas (`QUEUE_<X>_*`
 * overrides apply per queue).
 */
@Injectable()
export class PortalSplitProcessor implements OnModuleInit {
  constructor(
    private readonly workers: QueueWorkers,
    private readonly jobs: SplitJobsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const limiter = (def: { name: string }) =>
      defaultFetchLimiter(this.config, def);
    this.workers.register(
      PORTAL_PROFILE_QUEUE,
      (job, token) => this.jobs.profile(job, token),
      {
        limiter: limiter(PORTAL_PROFILE_QUEUE),
        onFinalFailure: (job, err) => this.jobs.onStudentFinalFailure(job, err),
      },
    );
    this.workers.register(
      PORTAL_MARKS_QUEUE,
      (job, token) => this.jobs.marks(job, token),
      {
        limiter: limiter(PORTAL_MARKS_QUEUE),
        onFinalFailure: (job, err) => this.jobs.onStudentFinalFailure(job, err),
      },
    );
    this.workers.register(
      PORTAL_DISCOVERY_QUEUE,
      (job, token) => this.jobs.discoverPortal(job, token),
      {
        limiter: limiter(PORTAL_DISCOVERY_QUEUE),
        onFinalFailure: (job, err) =>
          this.jobs.onDiscoveryFinalFailure(job, err),
      },
    );
    this.workers.register(
      PORTAL_WEEK_QUEUE,
      (job, token) => this.jobs.portalWeek(job, token),
      {
        limiter: limiter(PORTAL_WEEK_QUEUE),
        onFinalFailure: (job, err) => this.jobs.onUnitFinalFailure(job, err),
      },
    );
  }
}

/** Consumers of the split LMS queues (roles `worker-lms`, `worker`, `all`). */
@Injectable()
export class LmsSplitProcessor implements OnModuleInit {
  constructor(
    private readonly workers: QueueWorkers,
    private readonly jobs: SplitJobsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const limiter = (def: { name: string }) =>
      defaultFetchLimiter(this.config, def);
    this.workers.register(
      LMS_DISCOVERY_QUEUE,
      (job, token) => this.jobs.discoverLms(job, token),
      {
        limiter: limiter(LMS_DISCOVERY_QUEUE),
        onFinalFailure: (job, err) =>
          this.jobs.onDiscoveryFinalFailure(job, err),
      },
    );
    this.workers.register(
      LMS_MONTH_QUEUE,
      (job, token) => this.jobs.lmsMonth(job, token),
      {
        limiter: limiter(LMS_MONTH_QUEUE),
        onFinalFailure: (job, err) => this.jobs.onUnitFinalFailure(job, err),
      },
    );
  }
}
