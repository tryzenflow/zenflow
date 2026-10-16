import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IntegrationProvider } from "@zenflow/shared";
import { QueueService } from "../queue/queue.service";
import type { QueueDefinition } from "../queue/queue.types";
import {
  LMS_DISCOVERY_QUEUE,
  LMS_MONTH_QUEUE,
  PORTAL_DISCOVERY_QUEUE,
  PORTAL_PROFILE_QUEUE,
  PORTAL_WEEK_QUEUE,
  type DiscoveryJobData,
  type UnitJobData,
} from "../queue/queues";
import { idempotencyKey } from "../queue/queue.types";
import { isoWeekStart, monthsFrom, resolveSemester } from "./core/semester";
import { termKey } from "./core/schedule-plan";
import {
  IngestionScheduleService,
  type ClaimedTarget,
} from "./ingestion-schedule.service";
import { monthUnit } from "./lms-month.service";
import { SyncRunService } from "./sync-run.service";
import { weekUnit } from "./timetable-week.service";
import { errorMessage } from "./watcher-support";

const DAY_MS = 24 * 60 * 60_000;

function addDays(unit: string, days: number): string {
  const [y, m, d] = unit.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Producer side of the split ingestion queues: one place that turns a claimed
 * schedule row into the right jobs (discovery, profile, one job per week, one
 * job per month), shared by the connect flow and the watcher.
 */
@Injectable()
export class IngestionDispatchService {
  private readonly logger = new Logger(IngestionDispatchService.name);
  private readonly tz: string;

  constructor(
    config: ConfigService,
    private readonly queue: QueueService,
    private readonly schedule: IngestionScheduleService,
    private readonly runs: SyncRunService,
  ) {
    this.tz = config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
  }

  /**
   * A student just connected: queue the profile fetch and enrolment discovery.
   * Best effort, the watcher picks up anything that was not queued.
   */
  async onConnect(
    provider: IntegrationProvider,
    integrationId: string,
    userId: string,
    now = new Date(),
  ): Promise<void> {
    try {
      if (provider === "PORTAL") {
        await this.enqueueProfile(userId, integrationId, now);
        const claim = await this.schedule.claimOne(
          integrationId,
          "PORTAL_DISCOVERY",
          now,
        );
        if (claim) await this.enqueueDiscovery("PORTAL_DISCOVERY", claim);
      } else {
        const claim = await this.schedule.claimOne(
          integrationId,
          "LMS_DISCOVERY",
          now,
        );
        if (claim) await this.enqueueDiscovery("LMS_DISCOVERY", claim);
      }
    } catch (error) {
      this.logger.warn(
        `Could not queue the first ${provider} jobs for integration ${integrationId}: ${errorMessage(error)}`,
      );
    }
  }

  async enqueueProfile(
    userId: string,
    integrationId: string,
    now = new Date(),
  ): Promise<void> {
    await this.queue.enqueue(
      PORTAL_PROFILE_QUEUE,
      { userId, integrationId },
      // One per integration per day; a reconnect refreshes it.
      { jobId: idempotencyKey("profile", integrationId, dayBucket(now)) },
    );
  }

  /** Queue a discovery job carrying its claim. Returns false when the queue refused it. */
  async enqueueDiscovery(
    kind: "PORTAL_DISCOVERY" | "LMS_DISCOVERY",
    claim: ClaimedTarget,
  ): Promise<boolean> {
    const data: DiscoveryJobData = {
      userId: claim.userId,
      integrationId: claim.integrationId,
      scheduleId: claim.scheduleId,
      claimedAt: claim.claimedAt.toISOString(),
      dueAt: claim.dueAt.toISOString(),
      cacheHitStreak: claim.cacheHitStreak,
    };
    const def =
      kind === "PORTAL_DISCOVERY"
        ? PORTAL_DISCOVERY_QUEUE
        : LMS_DISCOVERY_QUEUE;
    try {
      await this.queue.enqueue(def, data, {
        jobId: idempotencyKey(
          "disc",
          claim.scheduleId,
          claim.dueAt.toISOString(),
        ),
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not queue ${kind} for schedule ${claim.scheduleId}: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Split the current term into one job per remaining ISO week. Returns false
   * when nothing could be queued (the caller hands the claim back).
   */
  async startTimetableRun(claim: ClaimedTarget, now: Date): Promise<boolean> {
    const term = resolveSemester(now, this.tz);
    const from = now > term.startDate ? now : term.startDate;
    const last = localDate(term.endDate, this.tz);
    const units: string[] = [];
    for (
      let monday = weekUnit(isoWeekStart(from, this.tz), this.tz);
      monday <= last;
      monday = addDays(monday, 7)
    ) {
      units.push(monday);
    }
    return this.startRun(
      claim,
      "PORTAL_TIMETABLE",
      termKey(term),
      units,
      PORTAL_WEEK_QUEUE,
      now,
    );
  }

  /** The current and the next month, as two jobs. */
  async startCalendarRun(claim: ClaimedTarget, now: Date): Promise<boolean> {
    const units = monthsFrom(now, this.tz, 2).map((m) =>
      monthUnit(m.year, m.month),
    );
    return this.startRun(
      claim,
      "LMS_CALENDAR",
      "calendar",
      units,
      LMS_MONTH_QUEUE,
      now,
    );
  }

  private async startRun(
    claim: ClaimedTarget,
    kind: "PORTAL_TIMETABLE" | "LMS_CALENDAR",
    scope: string,
    units: string[],
    def: QueueDefinition<UnitJobData>,
    now: Date,
  ): Promise<boolean> {
    if (units.length === 0) {
      // Term over: nothing to fetch, which is a clean pass.
      await this.schedule.recordOutcome(claim.scheduleId, {
        ok: true,
        servedFromCache: true,
        now,
      });
      return true;
    }
    const run = await this.runs.start({
      integrationId: claim.integrationId,
      kind,
      scope,
      units,
      claim,
    });
    let queued = 0;
    for (const unit of units) {
      try {
        await this.queue.enqueue(
          def,
          {
            runId: run.id,
            userId: claim.userId,
            integrationId: claim.integrationId,
            unit,
          },
          { jobId: idempotencyKey(def.name, run.id, unit) },
        );
        queued += 1;
      } catch (error) {
        this.logger.warn(
          `Could not queue ${kind} unit ${unit}: ${errorMessage(error)}`,
        );
        // Settle the unqueued unit as failed so the run closes and the claim
        // is handed back once the queued ones finish.
        await this.runs.report(
          run.id,
          unit,
          { ok: false, fetched: false },
          now,
        );
      }
    }
    return queued > 0;
  }
}

function dayBucket(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

function localDate(date: Date, tz: string): string {
  return weekUnit(date, tz);
}
