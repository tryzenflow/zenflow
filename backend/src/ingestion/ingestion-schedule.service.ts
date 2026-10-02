import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  IngestionSyncKind,
  IntegrationProvider,
} from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import {
  discoveredForTerm,
  isDiscoveryKind,
  nextDueAfterRun,
  providerOfKind,
  TERM_RETRY_MS,
  termKey,
  type SyncKindName,
  type SyncKindPlan,
} from "./core/schedule-plan";
import type { IntegrationTarget } from "./watcher-support";

/**
 * The rolling schedule's I/O half (issue #56): the `IngestionSchedule` rows, the
 * claim, and the per-pass bookkeeping the walk passes gate on.
 *
 * The arithmetic lives in `core/schedule-plan.ts`; everything here touches
 * Prisma, so it sits at the top level of `ingestion/` rather than in `core/*`
 * (invariant #2, same reason `watcher-support.ts` does).
 */

/**
 * Compile-time proof that the pure `SyncKindName` union and the generated
 * `IngestionSyncKind` enum have exactly the same members.
 *
 * `core/schedule-plan.ts` cannot import Prisma, so the two spell the five kinds
 * out independently and every `kind` value here crosses between them by plain
 * structural assignability — which silently keeps working if one side gains a
 * member the other lacks. Adding a kind to the schema without adding it to the
 * union (or vice versa) breaks this line instead of surfacing as a kind that is
 * never claimed.
 */
type KindsAgree = SyncKindName extends IngestionSyncKind
  ? IngestionSyncKind extends SyncKindName
    ? true
    : never
  : never;
const _kindsAgree: KindsAgree = true;
void _kindsAgree;

/** Every kind's default target period, in ms, and the env var that overrides it. */
const PLAN_DEFAULTS: Record<
  SyncKindName,
  { env: string; defaultMs: number; order: number }
> = {
  // Discovery first, and cheap: one DKHP history call answers "which sections is
  // this student in" for a whole term, so the period is a semester and the rows
  // spread across it through the claim batching.
  PORTAL_DISCOVERY: {
    env: "INGESTION_PORTAL_DISCOVERY_PERIOD_MS",
    defaultMs: 120 * 24 * 60 * 60_000,
    order: 1,
  },
  LMS_DISCOVERY: {
    env: "INGESTION_LMS_DISCOVERY_PERIOD_MS",
    defaultMs: 24 * 60 * 60_000,
    order: 2,
  },
  // A published timetable moves a handful of times a term, so daily is already
  // generous — and the walk is the expensive one (up to ~22 requests).
  PORTAL_TIMETABLE: {
    env: "INGESTION_TIMETABLE_PERIOD_MS",
    defaultMs: 24 * 60 * 60_000,
    order: 10,
  },
  // One request answers a whole term, so the period is about freshness alone.
  PORTAL_EXAM: {
    env: "INGESTION_EXAM_PERIOD_MS",
    defaultMs: 24 * 60 * 60_000,
    order: 11,
  },
  // The only genuinely frequent kind: an assignment deadline can be published
  // or moved at any hour, and a student who finds out an hour late still has
  // time to react.
  LMS_CALENDAR: {
    env: "INGESTION_LMS_CALENDAR_PERIOD_MS",
    defaultMs: 60 * 60_000,
    order: 12,
  },
};

/** Which kinds exist for each provider's `Integration` rows. */
const KINDS_BY_PROVIDER: Record<IntegrationProvider, SyncKindName[]> = {
  PORTAL: ["PORTAL_DISCOVERY", "PORTAL_TIMETABLE", "PORTAL_EXAM"],
  LMS: ["LMS_DISCOVERY", "LMS_CALENDAR"],
};

/** One claimed target, plus the scheduling state its pass needs. */
export interface ClaimedTarget extends IntegrationTarget {
  /** The `IngestionSchedule` row id, for {@link IngestionScheduleService.recordOutcome}. */
  scheduleId: string;
  /** Consecutive cache-served passes so far — drives the periodic full-walk audit. */
  cacheHitStreak: number;
}

/** What one pass did, as far as the schedule is concerned. */
export interface PassOutcome {
  /** False if any upstream request failed, or the pass threw. */
  ok: boolean;
  /** True when the pass issued no upstream requests at all. */
  servedFromCache: boolean;
}

@Injectable()
export class IngestionScheduleService {
  private readonly logger = new Logger(IngestionScheduleService.name);
  private readonly plans: readonly SyncKindPlan[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.plans = (Object.keys(PLAN_DEFAULTS) as SyncKindName[]).map((kind) => {
      const spec = PLAN_DEFAULTS[kind];
      return {
        kind,
        provider: providerOfKind(kind),
        targetPeriodMs: this.numberFromConfig(spec.env, spec.defaultMs),
        order: spec.order,
        discovery: isDiscoveryKind(kind),
      };
    });
  }

  /** Every kind's plan, for the ticker to iterate. */
  allPlans(): readonly SyncKindPlan[] {
    return this.plans;
  }

  planFor(kind: SyncKindName): SyncKindPlan {
    const plan = this.plans.find((p) => p.kind === kind);
    // Unreachable: `plans` is built from the exhaustive PLAN_DEFAULTS map.
    if (!plan) throw new Error(`no plan for sync kind ${kind}`);
    return plan;
  }

  /**
   * Create any missing schedule rows for one `Integration`. Idempotent.
   *
   * Called from `IntegrationsService` right after a student connects, so a new
   * integration does not wait for the next tick's {@link ensureAllRows} sweep to
   * be picked up at all.
   *
   * Every kind is seeded due immediately; the timetable walk gates itself on a
   * completed discovery (see `TimetableWatcherService.syncOne`).
   */
  async ensureRows(
    integrationId: string,
    provider: IntegrationProvider,
    now: Date = new Date(),
  ): Promise<number> {
    const data = KINDS_BY_PROVIDER[provider].map((kind) => ({
      integrationId,
      kind: kind,
      nextDueAt: now,
    }));
    // `skipDuplicates` against the [integrationId, kind] unique index is what
    // makes this safe to call on every reconnect and on every tick.
    const { count } = await this.prisma.ingestionSchedule.createMany({
      data,
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Seed schedule rows for every `Integration` that is missing one.
   *
   * The self-healing bootstrap, run at the top of each tick. It covers the three
   * ways a row can be absent: an integration that predates this feature, one
   * created by a path that forgot to call {@link ensureRows}, and one whose row
   * was removed by hand. Cheap in the steady state — one `findMany` per kind
   * that returns nothing.
   */
  async ensureAllRows(now: Date = new Date()): Promise<number> {
    let created = 0;
    for (const plan of this.plans) {
      const missing = await this.prisma.integration.findMany({
        where: {
          provider: plan.provider,
          schedules: { none: { kind: plan.kind } },
        },
        select: { id: true },
      });
      if (missing.length === 0) continue;

      const { count } = await this.prisma.ingestionSchedule.createMany({
        data: missing.map((row) => ({
          integrationId: row.id,
          kind: plan.kind,
          nextDueAt: now,
        })),
        skipDuplicates: true,
      });
      created += count;
    }
    if (created > 0) {
      this.logger.log(`Seeded ${created} ingestion schedule row(s)`);
    }
    return created;
  }

  /**
   * Claim up to `batchSize` of the most-overdue targets for `kind`.
   *
   * ## Why a compare-and-set rather than `FOR UPDATE SKIP LOCKED`
   *
   * Two ticks can overlap (a slow pass outlives its tick), and a target must
   * never be processed twice. The textbook answer is one raw
   * `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`:
   *
   * ```sql
   * UPDATE "IngestionSchedule" AS s
   *    SET "nextDueAt" = $next, "lastClaimedAt" = $now
   *  WHERE s.id IN (
   *    SELECT id FROM "IngestionSchedule"
   *     WHERE kind = $kind AND "nextDueAt" <= $now
   *     ORDER BY "nextDueAt" ASC LIMIT $batchSize
   *     FOR UPDATE SKIP LOCKED
   *  ) RETURNING s.id, s."integrationId";
   * ```
   *
   * It is one round trip and is the right answer at scale. It is not the answer
   * here, for two reasons: `batchSize` is 1–5 by design (so the loop below is
   * 1–5 tiny updates, not an N+1 worth worrying about), and `$queryRaw` cannot
   * be exercised by the in-memory Prisma double every ingestion spec is built
   * on, whereas an `updateMany` guard can. `nextDueAt` is already the natural
   * CAS token, so the correctness argument is visible in the code rather than
   * resting on the reader knowing Postgres locking. Switch to the statement
   * above if `batchSize` ever grows past roughly 50.
   *
   * ## Why the stamp happens on claim, not on completion
   *
   * A pass that throws must still have moved its `nextDueAt` forward. Otherwise
   * the next tick re-claims the same failing student, and the same one again,
   * starving everyone queued behind them — a single broken account would stop
   * ingestion for the whole population. `consecutiveFailures` is the observable
   * for repeated failure instead.
   */
  async claimDue(
    kind: SyncKindName,
    now: Date,
    batchSize: number,
  ): Promise<ClaimedTarget[]> {
    if (batchSize <= 0) return [];
    const plan = this.planFor(kind);

    const due = await this.prisma.ingestionSchedule.findMany({
      where: { kind: kind, nextDueAt: { lte: now } },
      // `id` breaks ties so a population seeded at one instant drains in a
      // stable order instead of an arbitrary one each tick.
      orderBy: [{ nextDueAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: {
        id: true,
        nextDueAt: true,
        cacheHitStreak: true,
        integrationId: true,
        integration: { select: { userId: true } },
      },
    });

    const claimed: ClaimedTarget[] = [];
    for (const row of due) {
      const { count } = await this.prisma.ingestionSchedule.updateMany({
        // The CAS: `nextDueAt` must still be the value this tick read. A
        // competing tick that got there first has already changed it, so this
        // update matches nothing and we simply skip the row.
        where: { id: row.id, nextDueAt: row.nextDueAt },
        data: {
          nextDueAt: nextDueAfterRun(now, plan.targetPeriodMs),
          lastClaimedAt: now,
        },
      });
      if (count !== 1) {
        this.logger.debug(
          `Lost the claim race for ${kind} schedule ${row.id}; another tick has it`,
        );
        continue;
      }
      claimed.push({
        scheduleId: row.id,
        integrationId: row.integrationId,
        userId: row.integration.userId,
        cacheHitStreak: row.cacheHitStreak,
      });
    }
    return claimed;
  }

  /**
   * Record what a pass did.
   *
   * `lastSuccessAt` only moves on a clean pass, because it is what the walk
   * passes read to decide whether a student's confirmed set is fresh enough to
   * trust. A failed discovery pass leaving it untouched is the mechanism that
   * makes "discovery is down" degrade into "we do more work" rather than "we
   * skip a student".
   *
   * `cacheHitStreak` counts consecutive cache-served passes and resets on any
   * live walk, so the periodic full-walk audit (`mustFullWalk`) measures
   * exactly what it claims to.
   */
  async recordOutcome(
    scheduleId: string,
    outcome: PassOutcome & { now: Date },
  ): Promise<void> {
    await this.prisma.ingestionSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: outcome.now,
        ...(outcome.ok
          ? { lastSuccessAt: outcome.now, consecutiveFailures: 0 }
          : { consecutiveFailures: { increment: 1 } }),
        ...(outcome.ok && outcome.servedFromCache
          ? { cacheHitStreak: { increment: 1 } }
          : { cacheHitStreak: 0 }),
      },
    });
  }

  /**
   * When `kind` last completed cleanly for this integration, or `null` if never.
   *
   * The walk passes call this with a discovery kind: it is the freshness signal
   * behind "no fresh discovery means a full live walk".
   */
  async lastSuccessAt(
    integrationId: string,
    kind: SyncKindName,
  ): Promise<Date | null> {
    const row = await this.prisma.ingestionSchedule.findUnique({
      where: {
        integrationId_kind: {
          integrationId,
          kind: kind,
        },
      },
      select: { lastSuccessAt: true },
    });
    return row?.lastSuccessAt ?? null;
  }

  /**
   * Record that a clean PORTAL_DISCOVERY pass covered `term` for this
   * integration. Called by the discovery pass itself, so a run triggered inline
   * by the timetable gate counts exactly like one the ticker claimed.
   */
  async markDiscovered(
    integrationId: string,
    term: { academicYear: string; semester: string },
    now: Date,
  ): Promise<void> {
    await this.prisma.ingestionSchedule.updateMany({
      where: { integrationId, kind: "PORTAL_DISCOVERY" },
      data: { lastSuccessAt: now, lastSuccessTerm: termKey(term) },
    });
  }

  /**
   * Has a clean discovery pass covered `term` for this integration? The gate the
   * timetable walk needs before it may fetch anything.
   */
  async isDiscovered(
    integrationId: string,
    term: { academicYear: string; semester: string },
  ): Promise<boolean> {
    const row = await this.prisma.ingestionSchedule.findUnique({
      where: {
        integrationId_kind: { integrationId, kind: "PORTAL_DISCOVERY" },
      },
      select: { lastSuccessTerm: true },
    });
    return discoveredForTerm(row?.lastSuccessTerm, term);
  }

  /**
   * Make every PORTAL_DISCOVERY row that has not covered `term` due now.
   *
   * The period is about a semester, so without this a term change would leave
   * students waiting out the rest of their period. A row claimed within
   * `TERM_RETRY_MS` is left alone, so a student whose discovery keeps failing
   * is retried hourly rather than every tick. The rows still go through
   * `claimDue`, so the batch cap spreads them as usual.
   */
  async pullForwardStaleDiscovery(
    term: { academicYear: string; semester: string },
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - TERM_RETRY_MS);
    const { count } = await this.prisma.ingestionSchedule.updateMany({
      where: {
        kind: "PORTAL_DISCOVERY",
        nextDueAt: { gt: now },
        lastSuccessTerm: { not: termKey(term) },
        OR: [{ lastClaimedAt: null }, { lastClaimedAt: { lt: cutoff } }],
      },
      data: { nextDueAt: now },
    });
    return count;
  }

  /** How many schedule rows exist for `kind` — the batch-sizing population. */
  async countFor(kind: SyncKindName): Promise<number> {
    return this.prisma.ingestionSchedule.count({
      where: { kind: kind },
    });
  }

  /**
   * Push a kind's next check out by a full target period.
   *
   * Used after a manual `POST /integrations/:provider/sync`: the student just
   * got fresh data, so re-walking them minutes later on the rolling schedule
   * would be pure waste against DLU.
   */
  async deferAfterManualSync(
    integrationId: string,
    provider: IntegrationProvider,
    now: Date = new Date(),
  ): Promise<void> {
    for (const kind of KINDS_BY_PROVIDER[provider]) {
      await this.prisma.ingestionSchedule.updateMany({
        where: { integrationId, kind: kind },
        data: {
          nextDueAt: nextDueAfterRun(now, this.planFor(kind).targetPeriodMs),
          lastRunAt: now,
        },
      });
    }
  }

  /**
   * A positive number from config, or `fallback`.
   *
   * Tolerates the string a `.env` file hands back as well as the number Joi
   * coerces it into, so a value works whether or not it went through the schema
   * — the same tolerance `isIngestionEnabled` has, for the same reason.
   */
  private numberFromConfig(name: string, fallback: number): number {
    const raw = this.config.get<number | string>(name);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
