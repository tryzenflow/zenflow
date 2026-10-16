import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { runCronJob } from "../observability/cron";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import {
  LMS_DISCOVERY_QUEUE,
  LMS_MONTH_QUEUE,
  PORTAL_DISCOVERY_QUEUE,
  PORTAL_FETCH_QUEUE,
  PORTAL_MARKS_QUEUE,
  PORTAL_WEEK_QUEUE,
  type FetchJobData,
} from "../queue/queues";
import type { QueueDefinition } from "../queue/queue.types";
import { idempotencyKey } from "../queue/queue.types";
import { resolveSemester } from "./core/semester";
import {
  batchSizeFor,
  orderedPlans,
  termKey,
  TICK_INTERVAL_MS,
  type SyncKindName,
  type SyncKindPlan,
} from "./core/schedule-plan";
import {
  IngestionScheduleService,
  type ClaimedTarget,
} from "./ingestion-schedule.service";
import { IngestionDispatchService } from "./ingestion-dispatch.service";
import { StudentSyncService } from "./student-sync.service";
import { SyncRunService } from "./sync-run.service";
import { errorMessage, isIngestionEnabled } from "./watcher-support";

/** What one tick did, per kind — returned for tests and logged when non-empty. */
export interface TickSummary {
  /** Targets claimed and handed to a fetch queue. */
  claimed: number;
  byKind: Partial<Record<SyncKindName | "PORTAL_PROFILE", number>>;
  /** Claims handed back un-enqueued because the queue refused the job. */
  released: number;
  /** Providers skipped this tick because their breaker is open. */
  pausedProviders: ("LMS" | "PORTAL")[];
  /** Kinds whose claim was skipped or trimmed because their queue is backed up. */
  backpressured: SyncKindName[];
  /** True when the queue Redis was unreachable and the tick stopped early. */
  queueUnavailable: boolean;
}

const EMPTY_TICK: TickSummary = {
  claimed: 0,
  byKind: {},
  released: 0,
  pausedProviders: [],
  backpressured: [],
  queueUnavailable: false,
};

const DEFAULT_MAX_BACKLOG = 500;

const DAY_MS = 24 * 60 * 60_000;

/** Profile and marks jobs queued per tick; the day-bucketed ids cap repeats. */
const STUDENT_JOBS_PER_TICK = 5;

/** About an hour of 5 second ticks. */
const PRUNE_EVERY_TICKS = 720;

/** Jobs a single claim of a walk kind fans out into (about a term of weeks). */
const UNITS_PER_CLAIM: Partial<Record<SyncKindName, number>> = {
  PORTAL_TIMETABLE: 25,
  LMS_CALENDAR: 2,
};

/**
 * The single heartbeat that drives all DLU ingestion (issue #56).
 *
 * ## What it replaced, and why
 *
 * Each of the three watchers used to carry its own `@Cron` whose firing swept
 * the **entire** student population in one instant. At 500 students that is a
 * few hundred logins back to back, once a day, from one IP — a recognisable
 * scheduled batch job rather than traffic from people using a calendar. Adding
 * a cache reduces how many requests happen; it does nothing about when.
 *
 * Now every `(integration, kind)` pair has its own `nextDueAt`, and this ticker
 * claims only the most-overdue `batchSize` per kind per minute. The same total
 * daily volume, spread continuously across ~1440 small ticks.
 *
 * ## Why one ticker for five kinds rather than five crons
 *
 * A single heartbeat is the only place that can hold an outbound budget across
 * kinds, and five independent crons landing on the same minute would put a
 * small burst back. The cost, stated plainly: a slow kind delays the kinds after
 * it within the same tick. That is bounded by `INGESTION_TICK_BUDGET_MS`,
 * checked between kinds — and because a delayed kind simply stays overdue, the
 * next tick picks it up first.
 *
 * ## Why `@Cron` is a literal and there is no `INGESTION_TICK_CRON`
 *
 * The cadence is expressed entirely by `nextDueAt` and the target periods; the
 * heartbeat only sets granularity, so making it configurable buys nothing and
 * costs a lot. Reading `process.env` inside the decorator would evaluate at
 * class-definition time, before `ConfigModule` has loaded `.env.dev`; and
 * registering the job imperatively through `SchedulerRegistry.addCronJob` needs
 * a `CronJob` from the `cron` package, which is a transitive dependency of
 * `@nestjs/schedule` and so not resolvable from `backend` under pnpm's strict
 * layout without adding a direct dependency for one string.
 *
 * A measurement run does not need it either: setting every
 * `INGESTION_*_PERIOD_MS` to 60000 and lifting `INGESTION_TICK_MAX_BATCH` makes
 * each tick claim the whole population, which reproduces the pre-#56
 * "all three watchers on EVERY_MINUTE" shape exactly — from config, with no
 * source edit. That is what the recorded baseline in
 * `scripts/fixtures/dlu/README.md` was measured under.
 */
@Injectable()
export class IngestionTickerService implements OnModuleInit {
  private readonly logger = new Logger(IngestionTickerService.name);
  private readonly maxBatch: number;
  private readonly budgetMs: number;
  private readonly maxBacklog: number;
  private readonly dluTimezone: string;
  /** Kinds already warned about for an undersized batch cap (once per boot). */
  private readonly warnedUndersized = new Set<string>();
  /** In-process guard: a tick must not start while the previous one runs. */
  private running = false;
  private ticks = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly schedule: IngestionScheduleService,
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly dispatch: IngestionDispatchService,
    private readonly runs: SyncRunService,
    private readonly student: StudentSyncService,
    private readonly lmsClient: LMSService,
    private readonly portalClient: PortalAPIService,
    private readonly killSwitch: KillSwitchService,
  ) {
    this.dluTimezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.maxBatch = this.positiveConfig("INGESTION_TICK_MAX_BATCH", 20);
    this.maxBacklog = this.positiveConfig(
      "INGESTION_QUEUE_MAX_BACKLOG",
      DEFAULT_MAX_BACKLOG,
    );
    this.budgetMs = this.positiveConfig(
      "INGESTION_TICK_BUDGET_MS",
      // Comfortably inside one tick, so a long tick cannot overlap the next.
      Math.floor(TICK_INTERVAL_MS * 0.8),
    );
  }

  /**
   * Log the resolved cadence once at boot.
   *
   * Worth the line: "why is nothing syncing" is almost always a target period
   * or the kill switch, and both are invisible otherwise.
   */
  onModuleInit(): void {
    if (!isIngestionEnabled(this.config)) {
      this.logger.warn("Ingestion is disabled (INGESTION_ENABLED=false)");
      return;
    }
    const periods = orderedPlans(this.schedule.allPlans())
      .map((p) => `${p.kind}=${Math.round(p.targetPeriodMs / 60_000)}m`)
      .join(" ");
    this.logger.log(
      `Rolling ingestion: tick ${TICK_INTERVAL_MS / 1000}s, ` +
        `maxBatch ${this.maxBatch}, periods ${periods}`,
    );
  }

  @Interval(TICK_INTERVAL_MS)
  async handleTick(): Promise<void> {
    await runCronJob("ingestion-ticker", async () => {
      const summary = await this.tick();
      if (summary.claimed > 0) {
        this.logger.log(
          `Ingestion tick: ${summary.claimed} enqueued, ` +
            `${summary.released} released`,
        );
      }
    });
  }

  /**
   * One tick: claim the most-overdue targets of each kind and enqueue a fetch job for each.
   *
   * `now` is a parameter so a test can drive the clock, matching the house shape
   * for every other scheduled job in the repo.
   */
  async tick(now: Date = new Date()): Promise<TickSummary> {
    // Checked BEFORE any claim, deliberately. Claiming and then skipping would
    // march the whole population's `nextDueAt` a full period forward while
    // ingestion is off, so flipping the switch back on would leave every student
    // "not due" for up to a day — a kill switch that silently costs a day of
    // freshness is not a kill switch.
    if (
      !isIngestionEnabled(this.config) ||
      !(await this.killSwitch.isEnabled("ingestion"))
    ) {
      return EMPTY_TICK;
    }

    // A pass can outlive its tick (a 22-week walk at a 750ms delay takes
    // ~17s, and a slow upstream makes that worse). The claim's compare-and-set
    // already makes double-processing impossible; this just avoids piling up
    // concurrent outbound work, which is the one thing the politeness policy
    // cares about.
    if (this.running) {
      this.logger.debug("Skipping tick: the previous one is still running");
      return EMPTY_TICK;
    }
    this.running = true;
    const startedAt = Date.now();

    const summary: TickSummary = {
      claimed: 0,
      byKind: {},
      released: 0,
      pausedProviders: [],
      backpressured: [],
      queueUnavailable: false,
    };
    // Waiting + delayed jobs per queue, read once per tick (a claim only adds
    // to it by the batch we are about to enqueue, tracked below).
    const backlog = new Map<string, number>();
    // Providers whose breaker is open (or tripped mid-tick). Checked before any
    // claim so a down upstream is never claimed for, and other providers carry on.
    const paused = new Set<"LMS" | "PORTAL">();

    try {
      // Self-healing: covers an integration that predates this feature, or one
      // whose row was removed by hand. A no-op in the steady state.
      await this.schedule.ensureAllRows(now);

      for (const plan of orderedPlans(this.schedule.allPlans())) {
        // Queue Redis is down: every further claim would only be handed back.
        if (summary.queueUnavailable) break;
        if (Date.now() - startedAt > this.budgetMs) {
          // Not an error: an unclaimed target simply stays overdue and is
          // first in line next tick.
          this.logger.debug(
            `Tick budget spent; deferring ${plan.kind} to the next tick`,
          );
          break;
        }
        if (this.upstreamOpen(plan.provider, paused)) continue;
        // A new term makes every student's discovery due, whatever its period.
        if (plan.kind === "PORTAL_DISCOVERY") {
          await this.schedule.pullForwardStaleDiscovery(
            resolveSemester(now, this.dluTimezone),
            now,
          );
        }

        const population = await this.schedule.countFor(plan.kind);
        const batchSize = batchSizeFor({
          population,
          targetPeriodMs: plan.targetPeriodMs,
          tickIntervalMs: TICK_INTERVAL_MS,
          minBatch: 1,
          maxBatch: this.maxBatch,
        });

        // The cap is a safety rail, not a throughput budget: if it admits fewer
        // claims per period than there are targets, the overdue queue grows
        // without bound and the cadence silently stretches. Say so.
        const capacityPerPeriod =
          this.maxBatch * Math.max(1, plan.targetPeriodMs / TICK_INTERVAL_MS);
        if (
          population > capacityPerPeriod &&
          !this.warnedUndersized.has(plan.kind)
        ) {
          this.warnedUndersized.add(plan.kind);
          this.logger.warn(
            `${plan.kind}: ${population} targets but INGESTION_TICK_MAX_BATCH=` +
              `${this.maxBatch} allows only ${capacityPerPeriod} claims per ` +
              `${Math.round(plan.targetPeriodMs / 60_000)}m period; the queue ` +
              `will fall behind. Raise the cap or lengthen the period.`,
          );
        }

        // Backpressure: never claim more than the queue has room for. A claim
        // moves `nextDueAt` a full period out, so claiming rows that will sit
        // in a backed-up queue would silently stretch their cadence.
        const def = this.queueFor(plan.kind);
        let pending = backlog.get(def.name);
        if (pending === undefined) {
          try {
            const counts = await this.queue.counts(def);
            pending = counts.waiting + counts.delayed;
            backlog.set(def.name, pending);
          } catch (error) {
            this.logger.warn(
              `Queue unavailable, stopping the tick: ${errorMessage(error)}`,
            );
            summary.queueUnavailable = true;
            break;
          }
        }
        const room = this.maxBacklog - pending;
        if (room <= 0) {
          summary.backpressured.push(plan.kind);
          this.logger.warn(
            `${def.name} backlog ${pending} >= INGESTION_QUEUE_MAX_BACKLOG=` +
              `${this.maxBacklog}; not claiming ${plan.kind} this tick`,
          );
          continue;
        }
        // A walk kind queues one job per week or month, so a claim costs
        // several slots of room, not one.
        const perClaim = UNITS_PER_CLAIM[plan.kind] ?? 1;
        const roomClaims = Math.max(1, Math.floor(room / perClaim));
        if (roomClaims < batchSize) summary.backpressured.push(plan.kind);

        const targets = await this.schedule.claimDue(
          plan.kind,
          now,
          Math.min(batchSize, roomClaims),
          this.gateFor(plan.kind, now),
        );
        if (targets.length === 0) continue;
        summary.byKind[plan.kind] = targets.length;
        backlog.set(def.name, pending + targets.length * perClaim);

        // Enqueue, never run: the workers do the (sequential) upstream work.
        // The claim above is the at-most-once guard; job ids make a re-enqueue
        // of the same slot a no-op.
        for (const target of targets) {
          if (summary.queueUnavailable) {
            // One bounded failure is enough: do not pay the timeout per row.
            await this.release(plan, target, summary);
            continue;
          }
          try {
            if (await this.dispatchTarget(plan, target, def, now)) {
              summary.claimed += 1;
            } else {
              summary.queueUnavailable = true;
              await this.release(plan, target, summary);
            }
          } catch (error) {
            // Queue Redis down or slow: hand the claim back so the row stays due.
            this.logger.warn(
              `Could not enqueue ${plan.kind} for schedule ` +
                `${target.scheduleId}: ${errorMessage(error)}`,
            );
            summary.queueUnavailable = true;
            await this.release(plan, target, summary);
          }
        }
      }

      if (!summary.queueUnavailable) {
        await this.enqueueStudentJobs(now, summary);
      }
      await this.housekeeping(now);
    } finally {
      this.running = false;
    }

    summary.pausedProviders = [...paused];
    return summary;
  }

  /** True (and remembered in `paused`) when `provider`'s breaker is open. */
  private upstreamOpen(
    provider: "LMS" | "PORTAL",
    paused: Set<"LMS" | "PORTAL">,
  ): boolean {
    if (paused.has(provider)) return true;
    const wait =
      provider === "LMS"
        ? this.lmsClient.unavailableFor()
        : this.portalClient.unavailableFor();
    if (wait === null) return false;
    paused.add(provider);
    this.logger.debug(
      `${provider} upstream breaker is open (~${Math.ceil(wait / 1000)}s); ` +
        `not claiming ${provider} work this tick`,
    );
    return true;
  }

  private async release(
    plan: SyncKindPlan,
    target: ClaimedTarget,
    summary: TickSummary,
  ): Promise<void> {
    summary.released += 1;
    try {
      await this.schedule.releaseClaim(target);
    } catch (error) {
      // Worst case the row waits out one period, as it would have pre-breaker.
      this.logger.warn(
        `Could not release the ${plan.kind} claim for schedule ` +
          `${target.scheduleId}: ${errorMessage(error)}`,
      );
    }
  }

  /** The queue a kind's jobs go to (the backlog check reads it). */
  private queueFor(kind: SyncKindName): QueueDefinition {
    switch (kind) {
      case "PORTAL_DISCOVERY":
        return PORTAL_DISCOVERY_QUEUE;
      case "LMS_DISCOVERY":
        return LMS_DISCOVERY_QUEUE;
      case "PORTAL_TIMETABLE":
        return PORTAL_WEEK_QUEUE;
      case "PORTAL_EXAM":
        return PORTAL_FETCH_QUEUE;
      case "LMS_CALENDAR":
        return LMS_MONTH_QUEUE;
    }
  }

  /**
   * Which rows a walk kind may claim: enrolment must already be discovered, so
   * the week and month jobs have sections or courses to work from.
   */
  private gateFor(kind: SyncKindName, now: Date) {
    if (kind === "PORTAL_TIMETABLE") {
      return {
        integration: {
          schedules: {
            some: {
              kind: "PORTAL_DISCOVERY" as const,
              lastSuccessTerm: termKey(resolveSemester(now, this.dluTimezone)),
            },
          },
        },
      };
    }
    if (kind === "LMS_CALENDAR") {
      return {
        integration: {
          schedules: {
            some: {
              kind: "LMS_DISCOVERY" as const,
              lastSuccessAt: { not: null },
            },
          },
        },
      };
    }
    return {};
  }

  /** Turn one claim into jobs. False when the queue could not take them. */
  private async dispatchTarget(
    plan: SyncKindPlan,
    target: ClaimedTarget,
    def: QueueDefinition,
    now: Date,
  ): Promise<boolean> {
    switch (plan.kind) {
      case "PORTAL_DISCOVERY":
      case "LMS_DISCOVERY":
        return this.dispatch.enqueueDiscovery(plan.kind, target);
      case "PORTAL_TIMETABLE":
        return this.dispatch.startTimetableRun(target, now);
      case "LMS_CALENDAR":
        return this.dispatch.startCalendarRun(target, now);
      case "PORTAL_EXAM":
        await this.queue.enqueue(
          def as unknown as QueueDefinition<FetchJobData>,
          this.jobData(plan, target),
          {
            jobId: idempotencyKey(
              target.scheduleId,
              target.dueAt.toISOString(),
            ),
          },
        );
        return true;
    }
  }

  private jobData(plan: SyncKindPlan, target: ClaimedTarget): FetchJobData {
    return {
      scheduleId: target.scheduleId,
      userId: target.userId,
      integrationId: target.integrationId,
      kind: plan.kind,
      dueAt: target.dueAt.toISOString(),
      claimedAt: target.claimedAt.toISOString(),
      cacheHitStreak: target.cacheHitStreak,
    };
  }

  /**
   * Profile for students without one, and marks for those whose marks are
   * missing or older than a day. Job ids carry a day bucket, so a failing
   * account is retried daily rather than every tick.
   */
  private async enqueueStudentJobs(
    now: Date,
    summary: TickSummary,
  ): Promise<void> {
    const day = Math.floor(now.getTime() / DAY_MS);
    try {
      const missing = await this.prisma.integration.findMany({
        where: { provider: "PORTAL", user: { studentProfile: null } },
        select: { id: true, userId: true },
        take: STUDENT_JOBS_PER_TICK,
      });
      for (const row of missing) {
        await this.dispatch.enqueueProfile(row.userId, row.id, now);
        summary.byKind.PORTAL_PROFILE =
          (summary.byKind.PORTAL_PROFILE ?? 0) + 1;
      }
      for (const due of await this.student.dueForMarks(
        now,
        STUDENT_JOBS_PER_TICK,
      )) {
        await this.queue.enqueue(PORTAL_MARKS_QUEUE, due, {
          jobId: idempotencyKey("marks", due.integrationId, day),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not queue student profile jobs: ${errorMessage(error)}`,
      );
    }
  }

  /** Close runs whose jobs vanished; prune old ones now and then. */
  private async housekeeping(now: Date): Promise<void> {
    try {
      await this.runs.sweepStale(now);
      this.ticks += 1;
      if (this.ticks % PRUNE_EVERY_TICKS === 0) await this.runs.prune(now);
    } catch (error) {
      this.logger.warn(`Run housekeeping failed: ${errorMessage(error)}`);
    }
  }

  /** A positive number from config, tolerating the string a `.env` file gives. */
  private positiveConfig(name: string, fallback: number): number {
    const value = Number(this.config.get<number | string>(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
