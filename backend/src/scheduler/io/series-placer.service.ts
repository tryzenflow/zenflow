import { Injectable } from "@nestjs/common";
import { SchedulingExperimentCoordinator } from "./scheduling-experiment-coordinator.service";
import { MAX_SCAN_DAYS, MAX_SERIES_PER_DAY } from "../constants";
import { seriesDayWindows } from "../core/series-spread";
import {
  addDaysStr,
  ceilToSlot,
  DAY_MS,
  localDateStr,
  MS_PER_MINUTE,
  type Interval,
} from "../core/slot";
import type {
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
 */
@Injectable()
export class SeriesPlacer {
  constructor(
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
    const windows = this.computeMemberWindows(
      next15Ms,
      deadline,
      members.length,
    );

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

    for (let i = 0; i < members.length; i++) {
      const applied = await this.placeMember(
        members[i],
        windows[i],
        context,
        ledger,
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

    return rows;
  }

  private computeMemberWindows(
    nextMs: number,
    deadline: Date,
    memberCount: number,
  ): [number, number][] {
    const daySpan = Math.min(
      Math.floor((deadline.getTime() - nextMs) / DAY_MS),
      MAX_SCAN_DAYS - 1,
    );
    return seriesDayWindows(daySpan, memberCount);
  }

  private async placeMember(
    member: SeriesMemberInput,
    memberWindow: [number, number],
    context: PlacementContext,
    ledger: PlacementLedger,
  ): Promise<Date | null> {
    const next15Ms = ceilToSlot(context.now.getTime());
    const durationMs = member.durationMinutes * MS_PER_MINUTE;
    if (next15Ms + durationMs > context.deadline.getTime()) return null;

    const window = this.memberPlacementWindow(context, memberWindow);
    const task = {
      id: member.id,
      durationMinutes: member.durationMinutes,
      deadline: context.deadline,
    };
    const opts = {
      extraOccupied: [...ledger.siblings],
      skipDay: (dayStr: string) =>
        (ledger.countByDay.get(dayStr) ?? 0) >= MAX_SERIES_PER_DAY,
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
