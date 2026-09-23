import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { minutesToUtc } from "../../common/utils";
import { SchedulingExperimentCoordinator } from "./scheduling-experiment-coordinator.service";
import { MAX_SCAN_DAYS, MAX_SERIES_PER_DAY } from "../constants";
import {
  seriesDayWindows,
  seriesWindowsAreDisjoint,
} from "../core/series-spread";
import { loadScheduleItems, dayLoadFromItems } from "./day-load";
import type { DayLoad } from "../types/day-load.types";
import {
  addDaysStr,
  ceilToSlot,
  DAY_MS,
  localDateStr,
  MS_PER_MINUTE,
  SLOT_MS,
  type Interval,
} from "../core/slot";
import type {
  BanditPick,
  PlacementWindow,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";
import {
  HeuristicPlacer,
  type PlaceInWindowOpts,
} from "./heuristic-placer.service";
import { BanditPlacer } from "./bandit-placer.service";

type PlacementLedger = {
  siblings: Interval[];
  countByDay: Map<string, number>;
};

type PlacementContext = {
  userId: string;
  timezone: string;
  preferenceMatrix: number[];
  now: Date;
  deadline: Date;
  startDayStr: string;
  trigger: "create" | "deadline-change";
  dryRun: boolean;
};

/**
 * Places every member of a `TASK` series (`sessionCount > 1`). Each member
 * gets its own non-overlapping day-window ({@link seriesDayWindows}); it is
 * then placed through the **same 50/50 heuristic-or-LinUCB A/B pick as a
 * single task** ({@link SchedulingExperimentCoordinator.run}), restricted to
 * that window. Because windows never overlap between members, two sittings
 * can only land on the same calendar day when their windows are the same
 * single day to begin with (a dense series — see {@link seriesDayWindows}'s
 * doc); `extraOccupied` siblings still never overlap in time, and
 * {@link MAX_SERIES_PER_DAY} still caps a day. A `SlotProposal` is recorded
 * per member (a dry run persists nothing — no member row even exists yet to
 * hang it off). A member that finds nowhere comes back `null` without
 * blocking the others. No existing session is moved.
 *
 * Per-member divergence/pairwise-pick isn't surfaced on the series response
 * yet (#41) — persistence is the caller's job ({@link TaskPlacementService}).
 *
 * Two independent batching wins over the naive N-sequential-member loop
 * (issue "batch series-member scoring", `docs/adr/` follow-up to #60/#62):
 * one DB read across the union of every member's day range instead of N
 * per-member reads (always applies — dense or disjoint), and, in the common
 * DISJOINT case ({@link seriesWindowsAreDisjoint}), member placement itself
 * runs concurrently with a single shared `/predict` round-trip
 * ({@link BanditPlacer.placeSeriesMembers}) instead of N sequential ones.
 * The dense edge case (`count > daySpan + 1`, several members forced onto
 * the same day) keeps today's exact sequential loop — {@link MAX_SERIES_PER_DAY}
 * / sibling-overlap bookkeeping genuinely depends on earlier members'
 * placements there.
 */
@Injectable()
export class SeriesPlacer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: SchedulingExperimentCoordinator,
    private readonly heuristic: HeuristicPlacer,
    private readonly bandit: BanditPlacer,
  ) {}

  async placeSeries(
    userId: string,
    series: {
      members: SeriesMemberInput[];
      deadline: Date;
      fixedOccupied?: Interval[];
    },
    timezone: string,
    preferenceMatrix: number[],
    now: Date,
    ctx: {
      trigger: "create" | "deadline-change";
      dryRun?: boolean;
    },
  ): Promise<SeriesPlacementRow[]> {
    const { members, deadline, fixedOccupied = [] } = series;
    const rows: SeriesPlacementRow[] = members.map((m) => ({
      id: m.id,
      scheduledStartTime: null,
    }));

    const next15Ms = ceilToSlot(now.getTime());
    if (members.length === 0 || next15Ms >= deadline.getTime()) return rows;

    const startDayStr = localDateStr(new Date(next15Ms), timezone);
    const daySpan = this.computeDaySpan(next15Ms, deadline);
    const windows = seriesDayWindows(daySpan, members.length);

    const context: PlacementContext = {
      userId,
      timezone,
      preferenceMatrix,
      now,
      deadline,
      startDayStr,
      trigger: ctx.trigger,
      dryRun: ctx.dryRun ?? false,
    };
    const ledger: PlacementLedger = {
      siblings: [...fixedOccupied],
      countByDay: new Map(),
    };

    const dayLoadsByMember = await this.loadUnionDayLoads(
      userId,
      members,
      windows,
      context,
    );

    if (seriesWindowsAreDisjoint(daySpan, members.length)) {
      await this.placeDisjointMembers(
        members,
        windows,
        context,
        ledger,
        dayLoadsByMember,
        rows,
      );
    } else {
      for (let i = 0; i < members.length; i++) {
        const applied = await this.placeMember(
          members[i],
          windows[i],
          context,
          ledger,
          dayLoadsByMember.get(members[i].id),
        );
        if (applied) {
          rows[i].scheduledStartTime = applied;
          this.recordSibling(
            ledger,
            applied,
            members[i].durationMinutes,
            timezone,
          );
        }
      }
    }

    return rows;
  }

  private computeDaySpan(nextMs: number, deadline: Date): number {
    return Math.min(
      Math.floor((deadline.getTime() - nextMs) / DAY_MS),
      MAX_SCAN_DAYS - 1,
    );
  }

  /**
   * One `loadScheduleItems` read across the union of every member's
   * day-window (they partition `[0, daySpan]`, so this is just the whole
   * scan range), then pure per-member/per-day slicing via
   * {@link dayLoadFromItems} — exactly {@link loadDayLoads}'s semantics, just
   * batched at the series level instead of once per member. Each member's
   * own row is excluded from its own slice client-side (`items` carries each
   * row's `id`), mirroring the `excludeSessionIds: [task.id]` a per-member
   * call would have passed — other members' already-scheduled rows (the
   * redistribute case) are NOT excluded from each other, same as before.
   */
  private async loadUnionDayLoads(
    userId: string,
    members: SeriesMemberInput[],
    windows: [number, number][],
    context: PlacementContext,
  ): Promise<Map<string, Map<string, DayLoad>>> {
    const result = new Map<string, Map<string, DayLoad>>();
    if (members.length === 0) return result;

    const maxHi = Math.max(...windows.map(([, hi]) => hi));
    const maxOverhangMs = Math.max(
      ...members.map((m) => m.durationMinutes * MS_PER_MINUTE - SLOT_MS),
    );
    const rangeStartMs = minutesToUtc(
      context.startDayStr,
      0,
      context.timezone,
    ).getTime();
    const rangeEndMs = minutesToUtc(
      addDaysStr(context.startDayStr, maxHi + 1),
      0,
      context.timezone,
    ).getTime();

    const items = await loadScheduleItems(this.prisma, {
      userId,
      rangeStartMs,
      rangeEndMs,
      timezone: context.timezone,
      lookaheadMs: maxOverhangMs,
    });

    members.forEach((member, i) => {
      const [lo, hi] = windows[i];
      const overhangMs = member.durationMinutes * MS_PER_MINUTE - SLOT_MS;
      const memberItems = items.filter((it) => it.id !== member.id);
      const dayMap = new Map<string, DayLoad>();
      for (let offset = lo; offset <= hi; offset++) {
        const dayStr = addDaysStr(context.startDayStr, offset);
        const dayStartMs = minutesToUtc(dayStr, 0, context.timezone).getTime();
        const dayEndMs = minutesToUtc(
          addDaysStr(dayStr, 1),
          0,
          context.timezone,
        ).getTime();
        dayMap.set(
          dayStr,
          dayLoadFromItems(memberItems, dayStartMs, dayEndMs, overhangMs),
        );
      }
      result.set(member.id, dayMap);
    });
    return result;
  }

  /**
   * DISJOINT case (the common one — see {@link seriesWindowsAreDisjoint}):
   * every member's window is independent of every other's, so their
   * heuristic scoring, bandit routing, and A/B assignment
   * ({@link SchedulingExperimentCoordinator.run} — verified free of
   * cross-call shared state) can all run concurrently instead of awaited one
   * at a time. The bandit path additionally shares ONE `/predict` round-trip
   * across every member that ends up needing it
   * ({@link BanditPlacer.placeSeriesMembers}), lazily triggered by whichever
   * member's coordinator run first calls `runBandit`. Ledger bookkeeping
   * (`recordSibling`) is deferred to a plain sequential pass AFTER every
   * promise resolves — it must never run concurrently with the scoring
   * itself, only sibling intervals never collide in time regardless, since
   * disjoint members can never land on the same day.
   */
  private async placeDisjointMembers(
    members: SeriesMemberInput[],
    windows: [number, number][],
    context: PlacementContext,
    ledger: PlacementLedger,
    dayLoadsByMember: Map<string, Map<string, DayLoad>>,
    rows: SeriesPlacementRow[],
  ): Promise<void> {
    const buildOpts = (member: SeriesMemberInput): PlaceInWindowOpts => ({
      extraOccupied: [...ledger.siblings],
      // Inert here by construction: disjoint windows never share a day, so
      // no member's countByDay entry can ever reach another member's window.
      skipDay: (dayStr) =>
        (ledger.countByDay.get(dayStr) ?? 0) >= MAX_SERIES_PER_DAY,
      preloadedDayLoads: dayLoadsByMember.get(member.id),
    });

    if (context.dryRun) {
      const starts = await Promise.all(
        members.map((member, i) =>
          this.placeHeuristicInWindow(
            this.memberTask(member, context),
            context,
            this.memberPlacementWindow(context, windows[i]),
            buildOpts(member),
          ),
        ),
      );
      starts.forEach((applied, i) => {
        if (applied) {
          rows[i].scheduledStartTime = applied;
          this.recordSibling(
            ledger,
            applied,
            members[i].durationMinutes,
            context.timezone,
          );
        }
      });
      return;
    }

    let sharedBandit: Promise<Map<string, BanditPick | null>> | null = null;
    const getSharedBandit = (): Promise<Map<string, BanditPick | null>> => {
      sharedBandit ??= this.bandit.placeSeriesMembers(
        context.userId,
        context.timezone,
        context.preferenceMatrix,
        context.now,
        members.map((member, i) => ({
          task: this.memberTask(member, context),
          window: this.memberPlacementWindow(context, windows[i]),
          opts: buildOpts(member),
        })),
      );
      return sharedBandit;
    };

    const outcomes = await Promise.all(
      members.map(async (member, i) => {
        const window = this.memberPlacementWindow(context, windows[i]);
        const opts = buildOpts(member);
        const heuristicStart = await this.placeHeuristicInWindow(
          this.memberTask(member, context),
          context,
          window,
          opts,
        );
        return this.coordinator.run({
          userId: context.userId,
          sessionId: member.id,
          trigger: context.trigger,
          heuristicStart,
          runBandit: async () =>
            (await getSharedBandit()).get(member.id) ?? null,
        });
      }),
    );

    outcomes.forEach((outcome, i) => {
      if (outcome.appliedStart) {
        rows[i].scheduledStartTime = outcome.appliedStart;
        this.recordSibling(
          ledger,
          outcome.appliedStart,
          members[i].durationMinutes,
          context.timezone,
        );
      }
    });
  }

  private memberTask(
    member: SeriesMemberInput,
    context: PlacementContext,
  ): { id: string; durationMinutes: number; deadline: Date } {
    return {
      id: member.id,
      durationMinutes: member.durationMinutes,
      deadline: context.deadline,
    };
  }

  private async placeMember(
    member: SeriesMemberInput,
    memberWindow: [number, number],
    context: PlacementContext,
    ledger: PlacementLedger,
    preloadedDayLoads?: Map<string, DayLoad>,
  ): Promise<Date | null> {
    const next15Ms = ceilToSlot(context.now.getTime());
    const durationMs = member.durationMinutes * MS_PER_MINUTE;
    if (next15Ms + durationMs > context.deadline.getTime()) return null;

    const window = this.memberPlacementWindow(context, memberWindow);
    const task = this.memberTask(member, context);
    const opts: PlaceInWindowOpts = {
      extraOccupied: [...ledger.siblings],
      skipDay: (dayStr: string) =>
        (ledger.countByDay.get(dayStr) ?? 0) >= MAX_SERIES_PER_DAY,
      preloadedDayLoads,
    };

    const heuristicStart = await this.placeHeuristicInWindow(
      task,
      context,
      window,
      opts,
    );
    if (context.dryRun) return heuristicStart;

    const outcome = await this.coordinator.run({
      userId: context.userId,
      sessionId: member.id,
      trigger: context.trigger,
      heuristicStart,
      runBandit: () =>
        this.bandit.placeInWindow(
          context.userId,
          task,
          context.timezone,
          context.preferenceMatrix,
          context.now,
          window,
          opts,
        ),
    });
    return outcome.appliedStart;
  }

  private placeHeuristicInWindow(
    task: { id: string; durationMinutes: number; deadline: Date },
    context: PlacementContext,
    window: PlacementWindow,
    opts: PlaceInWindowOpts,
  ): Promise<Date | null> {
    return this.heuristic
      .placeInWindow(
        context.userId,
        task,
        context.timezone,
        context.preferenceMatrix,
        context.now,
        window,
        opts,
      )
      .then((r) => r?.start ?? null);
  }

  private memberPlacementWindow(
    context: PlacementContext,
    [lo, hi]: [number, number],
  ): PlacementWindow {
    return {
      firstDayStr: addDaysStr(context.startDayStr, lo),
      lastDayStr: addDaysStr(context.startDayStr, hi),
    };
  }

  private recordSibling(
    ledger: PlacementLedger,
    applied: Date,
    durationMinutes: number,
    timezone: string,
  ): void {
    ledger.siblings.push({
      start: applied.getTime(),
      end: applied.getTime() + durationMinutes * MS_PER_MINUTE,
    });
    const dayStr = localDateStr(applied, timezone);
    ledger.countByDay.set(dayStr, (ledger.countByDay.get(dayStr) ?? 0) + 1);
  }
}
