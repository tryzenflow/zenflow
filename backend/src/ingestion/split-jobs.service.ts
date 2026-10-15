import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DelayedError, type Job } from "bullmq";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { UpstreamUnavailableError } from "../common/outbound-breaker";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { STALLED_REASON } from "../queue/create-worker";
import { parkBehindBreaker } from "../queue/with-breaker";
import type {
  DiscoveryJobData,
  MarksJobData,
  ProfileJobData,
  UnitJobData,
} from "../queue/queues";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { IngestionScheduleService } from "./ingestion-schedule.service";
import { LmsMonthService } from "./lms-month.service";
import { StudentSyncService } from "./student-sync.service";
import { SyncRunService, type UnitReport } from "./sync-run.service";
import { TimetableWeekService } from "./timetable-week.service";
import { errorMessage, isIngestionEnabled } from "./watcher-support";

/** How long a job parked by the kill switch waits before checking the flag again. */
const PAUSED_RECHECK_MS = 60_000;

type Provider = "PORTAL" | "LMS";

/**
 * Bodies of the split ingestion queues (`portal-profile`, `portal-marks`,
 * `portal-discovery`, `portal-week`, `lms-discovery`, `lms-month`).
 *
 * Shared job rules: nothing runs while ingestion is switched off (the job is
 * parked, no attempt used); an open upstream breaker parks the job for the
 * breaker's remaining time; any other error is rethrown for BullMQ's backoff
 * and, once attempts are exhausted, the unit or schedule row is closed out in
 * the matching `onFinalFailure` hook.
 */
@Injectable()
export class SplitJobsService {
  private readonly logger = new Logger(SplitJobsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly killSwitch: KillSwitchService,
    private readonly portalClient: PortalAPIService,
    private readonly lmsClient: LMSService,
    private readonly discovery: EnrollmentDiscoveryService,
    private readonly schedule: IngestionScheduleService,
    private readonly student: StudentSyncService,
    private readonly week: TimetableWeekService,
    private readonly month: LmsMonthService,
    private readonly runs: SyncRunService,
  ) {}

  profile(job: Job<ProfileJobData>, token?: string) {
    return this.guarded(job, token, "PORTAL", () =>
      this.student.syncProfile(job.data),
    );
  }

  marks(job: Job<MarksJobData>, token?: string) {
    return this.guarded(job, token, "PORTAL", () =>
      this.student.syncMarks(job.data),
    );
  }

  discoverPortal(job: Job<DiscoveryJobData>, token?: string) {
    return this.discover(job, token, "PORTAL");
  }

  discoverLms(job: Job<DiscoveryJobData>, token?: string) {
    return this.discover(job, token, "LMS");
  }

  portalWeek(job: Job<UnitJobData>, token?: string) {
    return this.unit(job, token, "PORTAL", () => this.week.syncWeek(job.data));
  }

  lmsMonth(job: Job<UnitJobData>, token?: string) {
    return this.unit(job, token, "LMS", () => this.month.syncMonth(job.data));
  }

  private async discover(
    job: Job<DiscoveryJobData>,
    token: string | undefined,
    provider: Provider,
  ) {
    const outcome = await this.guarded(job, token, provider, () => {
      const target = {
        integrationId: job.data.integrationId,
        userId: job.data.userId,
      };
      const now = new Date();
      return provider === "PORTAL"
        ? this.discovery.syncPortal(target, now)
        : this.discovery.syncLms(target, now);
    });
    // A partial pass cut short by an open breaker keeps its writes but is
    // neither a success nor a student failure.
    if (outcome.upstreamDown) throw outcome.upstreamDown;
    await this.settleDiscovery(job.data, outcome.ok);
    return { ok: outcome.ok };
  }

  private async unit(
    job: Job<UnitJobData>,
    token: string | undefined,
    provider: Provider,
    fn: () => Promise<UnitReport>,
  ) {
    const result = await this.guarded(job, token, provider, fn);
    await this.runs.report(job.data.runId, job.data.unit, result);
    return result;
  }

  /** `onFinalFailure` of the week and month queues. */
  async onUnitFinalFailure(job: Job<UnitJobData>, err: Error): Promise<void> {
    if (err instanceof UpstreamUnavailableError) {
      // Not the student's fault, but the unit still has to close the run.
      this.logger.debug(`Unit ${job.data.unit} parked out: ${err.message}`);
    }
    await this.runs.report(job.data.runId, job.data.unit, {
      ok: false,
      fetched: false,
    });
  }

  /** `onFinalFailure` of the discovery queues. */
  async onDiscoveryFinalFailure(
    job: Job<DiscoveryJobData>,
    err: Error,
  ): Promise<void> {
    if (err instanceof UpstreamUnavailableError) {
      await this.releaseDiscoveryClaim(job.data);
      return;
    }
    await this.settleDiscovery(job.data, false);
  }

  /** `onFinalFailure` of the profile and marks queues: nothing to close out. */
  onStudentFinalFailure(job: Job<ProfileJobData | MarksJobData>, err: Error) {
    this.logger.warn(
      `${job.queueName} gave up for integration ${job.data.integrationId}: ${errorMessage(err)}` +
        (STALLED_REASON.test(err.message) ? " (stalled)" : ""),
    );
    return Promise.resolve();
  }

  private async settleDiscovery(
    data: DiscoveryJobData,
    ok: boolean,
  ): Promise<void> {
    if (!data.scheduleId) return;
    try {
      await this.schedule.recordOutcome(data.scheduleId, {
        ok,
        servedFromCache: false,
        now: new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Could not record the discovery outcome: ${errorMessage(error)}`,
      );
    }
  }

  private async releaseDiscoveryClaim(data: DiscoveryJobData): Promise<void> {
    if (!data.scheduleId || !data.claimedAt || !data.dueAt) return;
    await this.schedule.releaseClaim({
      scheduleId: data.scheduleId,
      userId: data.userId,
      integrationId: data.integrationId,
      cacheHitStreak: data.cacheHitStreak ?? 0,
      dueAt: new Date(data.dueAt),
      claimedAt: new Date(data.claimedAt),
    });
  }

  private async guarded<T>(
    job: Job,
    token: string | undefined,
    provider: Provider,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (
      !isIngestionEnabled(this.config) ||
      !(await this.killSwitch.isEnabled("ingestion"))
    ) {
      if (token) {
        await job.moveToDelayed(Date.now() + PAUSED_RECHECK_MS, token);
        throw new DelayedError("ingestion paused");
      }
      throw new Error("ingestion paused");
    }
    try {
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
      return await fn();
    } catch (err) {
      if (err instanceof DelayedError) throw err;
      if (err instanceof UpstreamUnavailableError) {
        // Throws DelayedError, or `err` itself once parked too often.
        return parkBehindBreaker(job, token, err, { queue: job.queueName });
      }
      throw err;
    }
  }
}
