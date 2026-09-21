import { Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import {
  PLACEMENT_CONTRACT_VERSION,
  SCHEDULING_ARMS,
  type InfeasiblePolicy,
  type InfeasibleContext,
  type IntervalMs,
  type PlaceRequest,
  type PlacementMember,
  type SchedulingArm,
} from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { minutesToUtc } from "../../common/utils";
import { recordPhase } from "../../observability/phase-timings";
import { withSpan } from "../../observability/otel";
import { PrismaService } from "../../prisma/prisma.service";
import { BANDIT_ALPHA, BANDIT_RIDGE } from "../constants";
import {
  addDaysStr,
  ceilToSlot,
  DAY_MS,
  localDateStr,
  MS_PER_MINUTE,
  SLOT_MS,
  type Interval,
} from "../core/slot";
import type { PlaceableTask } from "../types/placement.types";
import { effectivePreferenceMatrix } from "../core/preference";
import { isFlexible } from "./displacement.service";
import { loadDayLoads, loadScheduleItems } from "./day-load";
import { loadObservationCount } from "./observation-count";
import { PlacementClient, type PlaceResult } from "./placement-client.service";

export interface GatewayRequestArgs {
  user: User;
  members: PlacementMember[];
  deadline: Date;
  now: Date;
  mode: "PLACE" | "PREFLIGHT";
  /** Load-scope decision owned by Nest: single 30, series 60. */
  maxScanDays: number;
  /** Rows being (re)placed; excluded from the occupancy load. */
  excludeSessionIds: string[];
  fixedOccupied?: Interval[];
}

/** Stored matrix if 168 finite numbers, else the shared cold-start default. */
const wireMatrix = (m: number[] | null | undefined): number[] => {
  const eff = effectivePreferenceMatrix(m ?? []);
  return eff.every(Number.isFinite) ? eff : effectivePreferenceMatrix([]);
};

const toMs = (i: Interval): IntervalMs => ({ startMs: i.start, endMs: i.end });

/**
 * Gather -> call half of ADR-0003: turns the existing loaders (`day-load`,
 * observation count, bandit `(A, b)`) into a `PlaceRequest`, sends it through
 * {@link PlacementClient}, and does the second, `infeasible`-carrying call of
 * the two-phase path. It never applies or persists anything.
 */
@Injectable()
export class PlacementGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PlacementClient,
    private readonly armStates: BanditArmStateRepository,
    @Optional() private readonly cls?: ClsService,
  ) {}

  get enabled(): boolean {
    return this.client.enabled;
  }

  async buildRequest(args: GatewayRequestArgs): Promise<PlaceRequest> {
    const { user, members, deadline, now } = args;
    const t0 = Date.now();
    const timezone = user.timezone;
    const next15Ms = ceilToSlot(now.getTime());
    const deadlineMs = deadline.getTime();
    const maxDuration = Math.max(...members.map((m) => m.durationMinutes));
    const overhangMs = maxDuration * MS_PER_MINUTE - SLOT_MS;

    const bounds: { dayStr: string; dayStartMs: number; dayEndMs: number }[] =
      [];
    if (next15Ms < deadlineMs) {
      const lastDayStr = localDateStr(new Date(deadlineMs - 1), timezone);
      for (
        let dayStr = localDateStr(new Date(next15Ms), timezone);
        dayStr <= lastDayStr && bounds.length < args.maxScanDays;
        dayStr = addDaysStr(dayStr, 1)
      ) {
        bounds.push({
          dayStr,
          dayStartMs: minutesToUtc(dayStr, 0, timezone).getTime(),
          dayEndMs: minutesToUtc(addDaysStr(dayStr, 1), 0, timezone).getTime(),
        });
      }
    }

    const needsBandit = members.some(
      (m) => m.primaryPolicy === "LINUCB" || m.computeBoth,
    );
    const [loads, observationCount, armState] = await Promise.all([
      loadDayLoads(this.prisma, {
        userId: user.id,
        days: bounds,
        timezone,
        excludeSessionIds: args.excludeSessionIds,
        occupiedLookaheadMs: overhangMs,
      }),
      loadObservationCount(this.prisma, user.id),
      needsBandit ? this.armStates.loadAll(user.id) : Promise.resolve(null),
    ]);
    recordPhase(this.cls, "dayload", Date.now() - t0);

    const bandit = armState
      ? {
          alpha: BANDIT_ALPHA,
          ridge: BANDIT_RIDGE,
          state: Object.fromEntries(
            SCHEDULING_ARMS.map((arm) => [
              arm,
              { A: armState[arm].A, b: armState[arm].b },
            ]),
          ) as Record<SchedulingArm, { A: number[]; b: number[] }>,
        }
      : undefined;

    return {
      contractVersion: PLACEMENT_CONTRACT_VERSION,
      requestId: randomUUID(),
      mode: args.mode,
      nowMs: now.getTime(),
      timezone,
      deadlineMs,
      maxScanDays: args.maxScanDays,
      members,
      fixedOccupied: (args.fixedOccupied ?? []).map(toMs),
      days: bounds.map((b, i) => ({
        ...b,
        occupied: loads[i].occupied.map(toMs),
        workloadByType: loads[i].workloadByType,
      })),
      user: {
        // Python requires exactly 168 finite floats (else 422); a new user has [].
        preferenceMatrix: wireMatrix(user.preferenceMatrix),
        observationCount,
      },
      ...(bandit ? { bandit } : {}),
    };
  }

  /** One `/v1/place` call, timed as the `placement.http` span / phase. */
  place(req: PlaceRequest): Promise<PlaceResult> {
    return withSpan(
      "placement.http",
      async (span) => {
        const t0 = Date.now();
        const result = await this.client.place(req);
        recordPhase(this.cls, "http", Date.now() - t0);
        span.setAttribute("placement.ok", result.ok);
        if (result.ok) {
          const t = result.response.timingsMs;
          span.setAttributes({
            "placement.python.decode_ms": t.decode,
            "placement.python.context_ms": t.context,
            "placement.python.predict_ms": t.predict,
            "placement.python.scan_ms": t.scan,
            "placement.python.displace_ms": t.displace,
            "placement.python.total_ms": t.total,
          });
          recordPhase(this.cls, "scan", t.scan);
          recordPhase(this.cls, "predict", t.predict);
        } else {
          span.setAttribute("placement.degraded_reason", result.reason);
        }
        return result;
      },
      { "placement.request_id": req.requestId, "placement.mode": req.mode },
    );
  }

  /**
   * Single-task call with the two-phase infeasible path (ADR-0003 3.3): when
   * the first answer is `NEEDS_INFEASIBLE_CONTEXT`, load the deadline-day +/-1
   * window and the +30-day horizon and repeat with `infeasible` set.
   */
  async placeSingleTwoPhase(
    req: PlaceRequest,
    user: User,
    task: PlaceableTask,
    policy: InfeasiblePolicy | undefined,
  ): Promise<PlaceResult> {
    const first = await this.place(req);
    if (
      !first.ok ||
      first.response.results[0]?.outcome !== "NEEDS_INFEASIBLE_CONTEXT"
    ) {
      return first;
    }
    const infeasible = await this.loadInfeasibleContext(
      user,
      task,
      new Date(req.nowMs),
      policy,
    );
    return this.place({
      ...req,
      requestId: `${req.requestId}-2`,
      infeasible,
    });
  }

  async loadInfeasibleContext(
    user: User,
    task: PlaceableTask,
    now: Date,
    policy?: InfeasiblePolicy,
  ): Promise<InfeasibleContext> {
    const tz = user.timezone;
    const deadlineMs = task.deadline.getTime();
    const deadlineDay = localDateStr(new Date(deadlineMs - 1), tz);
    const dayStart = minutesToUtc(deadlineDay, 0, tz).getTime();
    const dayEnd = minutesToUtc(addDaysStr(deadlineDay, 1), 0, tz).getTime();
    const horizonEndMs = deadlineMs + 30 * DAY_MS;

    const [windowItems, horizonItems] = await Promise.all([
      loadScheduleItems(this.prisma, {
        userId: user.id,
        rangeStartMs: dayStart - DAY_MS,
        rangeEndMs: dayEnd + DAY_MS,
        timezone: tz,
        excludeSessionIds: [task.id],
      }),
      loadScheduleItems(this.prisma, {
        userId: user.id,
        rangeStartMs: now.getTime(),
        rangeEndMs: horizonEndMs,
        timezone: tz,
        excludeSessionIds: [task.id],
      }),
    ]);
    return {
      ...(policy ? { policy } : {}),
      flexible: windowItems.filter(isFlexible).map((it) => ({
        id: it.id as string,
        durationMinutes: it.durationMinutes,
        deadlineMs: it.deadlineMs as number,
        startMs: it.start,
      })),
      fixed: windowItems
        .filter((it) => !isFlexible(it))
        .map((it) => ({ startMs: it.start, endMs: it.end })),
      horizonOccupied: horizonItems.map((it) => ({
        startMs: it.start,
        endMs: it.end,
      })),
    };
  }
}
