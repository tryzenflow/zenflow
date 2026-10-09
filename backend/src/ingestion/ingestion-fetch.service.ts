import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DelayedError, type Job } from "bullmq";
import type { IntegrationProvider } from "@zenflow/shared";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { STALLED_REASON } from "../queue/create-worker";
import { parkBehindBreaker } from "../queue/with-breaker";
import type { FetchJobData } from "../queue/queues";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { providerOfKind } from "./core/schedule-plan";
import type { SyncKindName } from "./core/schedule-plan";
import {
  DATA_KINDS_BY_PROVIDER,
  IngestionScheduleService,
  type ClaimedTarget,
} from "./ingestion-schedule.service";
import { TimetableWatcherService } from "./timetable-watcher.service";
import {
  errorMessage,
  isIngestionEnabled,
  type IntegrationTarget,
  type PassOutcome,
} from "./watcher-support";

/** How long a job parked by the kill switch waits before checking the flag again. */
const PAUSED_RECHECK_MS = 60_000;

/** What a finished fetch job returns (stored on the job; read by manual sync). */
export interface FetchResult {
  ok: boolean;
  servedFromCache: boolean;
  /** True when ingestion was switched off before the job ran. */
  skipped?: boolean;
}

/**
 * One student's pass for one schedule kind: the body of the `portal-fetch` and
 * `lms-fetch` jobs (formerly the ticker's sequential `runOne`/`dispatch`).
 *
 * Upstream failures: the DLU clients run every request under their own
 * breaker, so an open breaker surfaces here as `UpstreamUnavailableError` (or a
 * partial pass flagged `upstreamDown`). {@link handle} parks the job for the
 * breaker's remaining open time without using an attempt; any other error is
 * rethrown for BullMQ's exponential backoff and, once attempts are exhausted,
 * the schedule row is closed out ({@link recordExhausted}) before the job lands
 * in the DLQ.
 *
 * Retries are safe: a pass is the same idempotent walk the ticker has always
 * re-run (the materializer upserts by source key and only raises
 * notifications for new/changed/removed items), and the outcome is recorded
 * once, after the pass, so a retried job never double-counts.
 */
@Injectable()
export class IngestionFetchService {
  private readonly logger = new Logger(IngestionFetchService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedule: IngestionScheduleService,
    private readonly timetable: TimetableWatcherService,
    private readonly exam: ExamWatcherService,
    private readonly lms: LmsWatcherService,
    private readonly discovery: EnrollmentDiscoveryService,
    private readonly lmsClient: LMSService,
    private readonly portalClient: PortalAPIService,
    private readonly killSwitch: KillSwitchService,
  ) {}

  /**
   * Queue-job entry point. Resolves with the pass result; throws
   * `DelayedError` (parked), or the pass's error (retry / DLQ).
   */
  async handle(job: Job<FetchJobData>, token?: string): Promise<FetchResult> {
    try {
      const result = await this.execute(job.data);
      if (result.skipped && !job.data.manual && token) {
        // Ingestion is switched off but the ticker already claimed this slot
        // (`nextDueAt` is a period ahead). Completing the job would strand the
        // student until the next period, and its stable job id would swallow a
        // re-enqueue. Park it instead (no attempt used): it runs once the
        // switch is back on.
        await job.moveToDelayed(Date.now() + PAUSED_RECHECK_MS, token);
        throw new DelayedError("ingestion paused");
      }
      return result;
    } catch (err) {
      if (err instanceof DelayedError) throw err;
      if (err instanceof UpstreamUnavailableError) {
        // Throws DelayedError, or `err` itself once parked too often.
        try {
          return await parkBehindBreaker(job, token, err, {
            queue: job.queueName,
          });
        } catch (parkErr) {
          if (parkErr !== err) throw parkErr;
          await this.recordExhausted(job.data, err, job);
          throw err;
        }
      }
      await this.recordExhausted(job.data, err, job);
      throw err;
    }
  }

  /**
   * Run the pass and do its bookkeeping. Throws `UpstreamUnavailableError` when
   * the upstream breaker is open (nothing is recorded: not the student's fault).
   */
  async execute(data: FetchJobData, now = new Date()): Promise<FetchResult> {
    if (
      !isIngestionEnabled(this.config) ||
      !(await this.killSwitch.isEnabled("ingestion"))
    ) {
      return { ok: false, servedFromCache: false, skipped: true };
    }
    const kind = data.kind as SyncKindName;
    const provider = providerOfKind(kind);
    // Peek first: no login, no request while the breaker is open.
    const wait =
      provider === "LMS"
        ? this.lmsClient.unavailableFor()
        : this.portalClient.unavailableFor();
    if (wait !== null) {
      throw new UpstreamUnavailableError(
        provider === "LMS" ? "dlu-lms" : "dlu-portal",
        wait,
      );
    }

    const outcome = await this.dispatch(kind, this.targetOf(data), now);
    // A partial walk cut short by an open breaker keeps its writes but is
    // neither a success nor a student failure.
    if (outcome.upstreamDown) throw outcome.upstreamDown;

    await this.record(data, kind, provider, outcome, now);
    return { ok: outcome.ok, servedFromCache: outcome.servedFromCache };
  }

  /**
   * Close out a job that will not run again (attempts exhausted, or parked too
   * long), so the schedule row reflects the failure. No-op while retries
   * remain. An unavailable upstream is not counted against the student.
   */
  async recordExhausted(
    data: FetchJobData,
    err: unknown,
    job: Pick<Job, "attemptsMade" | "opts">,
  ): Promise<void> {
    const attempts = job.opts?.attempts ?? 1;
    const last =
      err instanceof UpstreamUnavailableError ||
      job.attemptsMade + 1 >= attempts;
    if (!last) return;
    this.logger.warn(
      `${data.kind} fetch for integration ${data.integrationId} gave up: ${errorMessage(err)}`,
    );
    if (err instanceof UpstreamUnavailableError) return;
    try {
      if (data.manual) {
        await this.markManualFailure(data);
      } else {
        await this.schedule.recordOutcome(data.scheduleId, {
          ok: false,
          servedFromCache: false,
          now: new Date(),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not record the failed ${data.kind} outcome: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * `onFinalFailure` hook of the fetch queues. Only a job that stalled past its
   * limit needs work here: `handle` already closes out every other final
   * failure (recording it again would double-count). A stalled scheduled job
   * gets its claim handed back so the row is due again at once rather than a
   * full period later; the failed job is removed first so its id does not block
   * that re-enqueue. The claim hand-back is a compare-and-set on the claim, so running on
   * several replicas, or twice, is harmless. Manual jobs hold no claim.
   */
  async onFinalFailure(job: Job<FetchJobData>, err: Error): Promise<void> {
    if (!STALLED_REASON.test(err.message)) return;
    const { data } = job;
    if (data.manual || !data.claimedAt || !data.scheduleId) return;
    // The failed job is retained (and its id is the slot's idempotency key), so
    // it would swallow the re-enqueue of this very slot on the next tick.
    try {
      await job.remove();
    } catch (error) {
      this.logger.warn(
        `Could not remove the stalled ${data.kind} job ${job.id}: ${errorMessage(error)}`,
      );
    }
    await this.schedule.releaseClaim({
      scheduleId: data.scheduleId,
      userId: data.userId,
      integrationId: data.integrationId,
      cacheHitStreak: data.cacheHitStreak ?? 0,
      dueAt: new Date(data.dueAt),
      claimedAt: new Date(data.claimedAt),
    });
  }

  private async record(
    data: FetchJobData,
    kind: SyncKindName,
    provider: IntegrationProvider,
    outcome: PassOutcome,
    now: Date,
  ): Promise<void> {
    try {
      if (!data.manual) {
        await this.schedule.recordOutcome(data.scheduleId, {
          ok: outcome.ok,
          servedFromCache: outcome.servedFromCache,
          now,
        });
      } else if (outcome.ok) {
        // The student just got fresh data by hand: push the kinds that came
        // back clean out by a period. A clean timetable pass implies discovery
        // covered the term (it is the gate).
        const kinds: SyncKindName[] =
          kind === "PORTAL_TIMETABLE"
            ? ["PORTAL_DISCOVERY", "PORTAL_TIMETABLE"]
            : [kind];
        await this.schedule.deferAfterManualSync(
          data.integrationId,
          kinds,
          now,
        );
      } else {
        await this.markManualFailure(data, provider);
      }
    } catch (error) {
      // Losing the bookkeeping is bad but not worth failing the job over (a
      // retry would re-walk): the claim already moved `nextDueAt`.
      this.logger.warn(
        `Could not record the ${kind} outcome for integration ` +
          `${data.integrationId}: ${errorMessage(error)}`,
      );
    }
  }

  private markManualFailure(
    data: FetchJobData,
    provider = providerOfKind(data.kind as SyncKindName),
  ): Promise<void> {
    // Only this job's kind counts as failed; its sibling may have been clean.
    const others = DATA_KINDS_BY_PROVIDER[provider].filter(
      (k) => k !== data.kind,
    );
    return this.schedule.markManualFailure(
      data.integrationId,
      provider,
      others,
    );
  }

  private targetOf(data: FetchJobData): IntegrationTarget | ClaimedTarget {
    const base = { integrationId: data.integrationId, userId: data.userId };
    if (data.manual || !data.claimedAt) return base;
    return {
      ...base,
      scheduleId: data.scheduleId,
      cacheHitStreak: data.cacheHitStreak ?? 0,
      dueAt: new Date(data.dueAt),
      claimedAt: new Date(data.claimedAt),
    };
  }

  /** Map a kind onto the service that performs it. */
  private dispatch(
    kind: SyncKindName,
    target: IntegrationTarget,
    now: Date,
  ): Promise<PassOutcome> {
    switch (kind) {
      case "PORTAL_TIMETABLE":
        return this.timetable.syncOne(target, now);
      case "PORTAL_EXAM":
        return this.exam.syncOne(target, now);
      case "LMS_CALENDAR":
        return this.lms.syncOne(target, now);
      case "PORTAL_DISCOVERY":
        return this.discovery.syncPortal(target, now);
      case "LMS_DISCOVERY":
        return this.discovery.syncLms(target, now);
    }
  }
}
