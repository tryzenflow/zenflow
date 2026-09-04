import { Injectable } from "@nestjs/common";
import { SchedulingModel } from "../../../generated/prisma";
import { ExperimentService } from "../../experiments/experiment.service";
import { MAX_SCAN_DAYS, MAX_SERIES_PER_DAY } from "../constants";
import { clampWindowForMember, seriesDayOffsets } from "../core/series-spread";
import {
  addDaysStr,
  ceilToSlot,
  dayDiffStr,
  localDateStr,
  MS_PER_MINUTE,
  type Interval,
} from "../core/slot";
import type {
  PlacementWindow,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";
import { HeuristicPlacer } from "./heuristic-placer.service";
import { BanditPlacer } from "./bandit-placer.service";

/**
 * Places every member of a `TASK` series (`sessionCount > 1`). Each member gets
 * an even-spread target day ({@link seriesDayOffsets}); it is then placed
 * through the **same 50/50 heuristic-or-LinUCB pick as a single task**
 * ({@link HeuristicPlacer.placeInWindow} / {@link BanditPlacer.placeInWindow}),
 * but with its candidate-day window clamped to `± max(1, floor(X/N))` around
 * that target ({@link clampWindowForMember}, D3). Siblings never overlap;
 * {@link MAX_SERIES_PER_DAY} still caps a day; a `SlotProposal` is recorded per
 * member. A member that finds nowhere comes back `null` without blocking the
 * others. No existing session is moved.
 *
 * Persistence is the caller's job ({@link TaskPlacementService}).
 */
@Injectable()
export class SeriesPlacer {
  constructor(
    private readonly experiment: ExperimentService,
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
    ctx: { trigger: "create" | "deadline-change" },
  ): Promise<SeriesPlacementRow[]> {
    const { members, deadline, fixedOccupied = [] } = series;
    const rows: SeriesPlacementRow[] = members.map((m) => ({
      id: m.id,
      scheduledStartTime: null,
    }));

    const next15Ms = ceilToSlot(now.getTime());
    const deadlineMs = deadline.getTime();
    if (members.length === 0 || next15Ms >= deadlineMs) return rows;

    const startDayStr = localDateStr(new Date(next15Ms), timezone);
    const lastDayStr = localDateStr(new Date(deadlineMs - 1), timezone);
    const daySpan = Math.min(
      dayDiffStr(startDayStr, lastDayStr),
      MAX_SCAN_DAYS - 1,
    );
    const targets = seriesDayOffsets(daySpan, members.length);

    const countByDay = new Map<string, number>();
    const siblings: Interval[] = [...fixedOccupied];
    const skipDay = (dayStr: string) =>
      (countByDay.get(dayStr) ?? 0) >= MAX_SERIES_PER_DAY;

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const durationMs = member.durationMinutes * MS_PER_MINUTE;
      // Each member is independently assigned a 50/50 primary policy.
      const { primaryPolicy, randomizationSeed } =
        this.experiment.assignPolicy();

      let heuristicStart: Date | null = null;
      let pick: Awaited<ReturnType<BanditPlacer["placeInWindow"]>> = null;

      if (next15Ms + durationMs <= deadlineMs) {
        const [lo, hi] = clampWindowForMember(
          daySpan,
          members.length,
          targets[i],
        );
        const window: PlacementWindow = {
          firstDayStr: addDaysStr(startDayStr, lo),
          lastDayStr: addDaysStr(startDayStr, hi),
        };
        const task = {
          id: member.id,
          durationMinutes: member.durationMinutes,
          deadline,
        };
        // Snapshot so a later member's push doesn't mutate this call's blocks.
        const opts = { extraOccupied: [...siblings], skipDay };

        heuristicStart =
          (
            await this.heuristic.placeInWindow(
              userId,
              task,
              timezone,
              preferenceMatrix,
              now,
              window,
              opts,
            )
          )?.start ?? null;

        if (primaryPolicy === SchedulingModel.LINUCB) {
          pick = await this.bandit.placeInWindow(
            userId,
            task,
            timezone,
            preferenceMatrix,
            now,
            window,
            opts,
          );
        }
      }

      const applied = pick?.scheduledStartTime ?? heuristicStart;
      if (applied) {
        rows[i].scheduledStartTime = applied;
        siblings.push({
          start: applied.getTime(),
          end: applied.getTime() + durationMs,
        });
        const dayStr = localDateStr(applied, timezone);
        countByDay.set(dayStr, (countByDay.get(dayStr) ?? 0) + 1);
      }

      // One SlotProposal per member (docs/scheduler/ab-testing.md §2).
      await this.experiment.recordProposal({
        userId,
        sessionId: member.id,
        trigger: ctx.trigger,
        primaryPolicy,
        randomizationSeed,
        heuristicProposal: {
          scheduledStartTime: heuristicStart?.toISOString() ?? null,
        },
        proposedStartTime: applied ?? null,
        modelProposal: pick
          ? {
              scheduledStartTime: pick.scheduledStartTime,
              selectedArm: pick.selectedArm,
            }
          : null,
        featureVector: pick?.featureVector ?? [],
        selectedArm: pick?.selectedArm ?? null,
      });
    }

    return rows;
  }
}
