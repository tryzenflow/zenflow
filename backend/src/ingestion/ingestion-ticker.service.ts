import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { runCronJob } from "../observability/cron";
import { EnrollmentDiscoveryService } from "./enrollment-discovery.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { resolveSemester } from "./core/semester";
import {
  batchSizeFor,
  orderedPlans,
  TICK_INTERVAL_MS,
  type SyncKindName,
  type SyncKindPlan,
} from "./core/schedule-plan";
import {
  IngestionScheduleService,
  type ClaimedTarget,
} from "./ingestion-schedule.service";
import { TimetableWatcherService } from "./timetable-watcher.service";
import {
  errorMessage,
  isIngestionEnabled,
  type PassOutcome,
} from "./watcher-support";

/** What one tick did, per kind — returned for tests and logged when non-empty. */
export interface TickSummary {
  claimed: number;
  ok: number;
  failed: number;
  servedFromCache: number;
  byKind: Partial<Record<SyncKindName, number>>;
}

const EMPTY_TICK: TickSummary = {
  claimed: 0,
  ok: 0,
  failed: 0,
  servedFromCache: 0,
  byKind: {},
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
  private readonly dluTimezone: string;
  /** Kinds already warned about for an undersized batch cap (once per boot). */
  private readonly warnedUndersized = new Set<string>();
  /** In-process guard: a tick must not start while the previous one runs. */
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly schedule: IngestionScheduleService,
    private readonly timetable: TimetableWatcherService,
    private readonly exam: ExamWatcherService,
    private readonly lms: LmsWatcherService,
    private readonly discovery: EnrollmentDiscoveryService,
  ) {
    this.dluTimezone = this.config.get<string>("DLU_TZ") ?? "Asia/Ho_Chi_Minh";
    this.maxBatch = this.positiveConfig("INGESTION_TICK_MAX_BATCH", 20);
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

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick(): Promise<void> {
    await runCronJob("ingestion-ticker", async () => {
      const summary = await this.tick();
      if (summary.claimed > 0) {
        this.logger.log(
          `Ingestion tick: ${summary.claimed} claimed ` +
            `(${summary.ok} ok, ${summary.failed} failed, ` +
            `${summary.servedFromCache} from cache)`,
        );
      }
    });
  }

  /**
   * One tick: claim and process the most-overdue targets of each kind.
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
    if (!isIngestionEnabled(this.config)) return EMPTY_TICK;

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
      ok: 0,
      failed: 0,
      servedFromCache: 0,
      byKind: {},
    };

    try {
      // Self-healing: covers an integration that predates this feature, or one
      // whose row was removed by hand. A no-op in the steady state.
      await this.schedule.ensureAllRows(now);

      for (const plan of orderedPlans(this.schedule.allPlans())) {
        if (Date.now() - startedAt > this.budgetMs) {
          // Not an error: an unclaimed target simply stays overdue and is
          // first in line next tick.
          this.logger.debug(
            `Tick budget spent; deferring ${plan.kind} to the next tick`,
          );
          break;
        }
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

        const targets = await this.schedule.claimDue(plan.kind, now, batchSize);
        if (targets.length === 0) continue;
        summary.byKind[plan.kind] = targets.length;

        // Sequentially, always. Sequential outbound requests are the entirety
        // of the politeness policy (see `watcher-support.ts`), and fanning out
        // here is exactly what would turn a tick back into a burst.
        for (const target of targets) {
          const outcome = await this.runOne(plan, target, now);
          summary.claimed += 1;
          if (outcome.ok) summary.ok += 1;
          else summary.failed += 1;
          if (outcome.servedFromCache) summary.servedFromCache += 1;
        }
      }
    } finally {
      this.running = false;
    }

    return summary;
  }

  /**
   * Run one claimed target's pass and record what happened.
   *
   * Never throws. A pass that blows up must not abort the tick — the other
   * students in the batch have nothing to do with it — so the failure is
   * recorded on the schedule row (`consecutiveFailures`) and the loop continues.
   */
  private async runOne(
    plan: SyncKindPlan,
    target: ClaimedTarget,
    now: Date,
  ): Promise<PassOutcome> {
    let outcome: PassOutcome = { ok: false, servedFromCache: false };
    try {
      outcome = await this.dispatch(plan.kind, target, now);
    } catch (error) {
      this.logger.warn(
        `${plan.kind} pass failed for integration ${target.integrationId}: ` +
          errorMessage(error),
      );
    }
    try {
      await this.schedule.recordOutcome(target.scheduleId, {
        ...outcome,
        now,
      });
    } catch (error) {
      // Losing the bookkeeping is bad but not worth failing the tick over: the
      // claim already moved `nextDueAt`, so nothing loops.
      this.logger.warn(
        `Could not record the ${plan.kind} outcome for schedule ` +
          `${target.scheduleId}: ${errorMessage(error)}`,
      );
    }
    return outcome;
  }

  /** Map a kind onto the service that performs it. */
  private async dispatch(
    kind: SyncKindName,
    target: ClaimedTarget,
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

  /** A positive number from config, tolerating the string a `.env` file gives. */
  private positiveConfig(name: string, fallback: number): number {
    const value = Number(this.config.get<number | string>(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
