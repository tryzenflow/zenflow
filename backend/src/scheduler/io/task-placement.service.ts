import { Injectable, Logger } from "@nestjs/common";
import { SchedulingModel, type User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { ExperimentService } from "../../experiments/experiment.service";
import { HeuristicPlacer } from "./heuristic-placer.service";
import { BanditPlacer } from "./bandit-placer.service";
import { SeriesPlacer } from "./series-placer.service";
import type {
  PlaceableTask,
  PlacementResult,
  SeriesMemberInput,
  SeriesPlacementRow,
} from "../types/placement.types";

type Trigger = "create" | "deadline-change";

/**
 * The single placement entry point `sessions/` talks to. It owns the whole
 * "place a `TASK` and persist its `scheduledStartTime`" flow — heuristic pass,
 * the 50/50 A/B policy assignment, the optional LinUCB override, and the
 * `SlotProposal` record — so `SessionsService` never touches `assignPolicy`
 * or `recordProposal` directly. Nothing else on the calendar is ever moved.
 *
 * The A/B override runs per single `TASK` and per series member
 * (`docs/scheduler/ab-testing.md`); a bandit failure always falls back to the
 * heuristic placement and never throws.
 */
@Injectable()
export class TaskPlacementService {
  private readonly logger = new Logger(TaskPlacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly experiment: ExperimentService,
    private readonly heuristic: HeuristicPlacer,
    private readonly bandit: BanditPlacer,
    private readonly seriesPlacer: SeriesPlacer,
  ) {}

  /** Place a freshly-created single `TASK`. */
  placeOnCreate(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
  }): Promise<PlacementResult> {
    return this.placeSingle(args.user, args.task, "create", args.now);
  }

  /** Re-place a single `TASK` after its deadline changed. */
  placeOnDeadlineChange(args: {
    user: User;
    task: PlaceableTask;
    now: Date;
  }): Promise<PlacementResult> {
    return this.placeSingle(args.user, args.task, "deadline-change", args.now);
  }

  /**
   * heuristic place → persist → assignPolicy 50/50 → (LINUCB) bandit place →
   * persist + `recordProposal`. Best-effort: any A/B failure leaves the
   * heuristic placement standing.
   */
  private async placeSingle(
    user: User,
    task: PlaceableTask,
    trigger: Trigger,
    now: Date,
  ): Promise<PlacementResult> {
    const heuristicStart = await this.heuristic.placeTask(
      user.id,
      task,
      user.timezone,
      user.preferenceMatrix,
      now,
    );
    if (heuristicStart) {
      await this.prisma.session.update({
        where: { id: task.id },
        data: { scheduledStartTime: heuristicStart },
      });
    }

    let appliedStart = heuristicStart;
    let appliedPolicy: PlacementResult["appliedPolicy"] = heuristicStart
      ? "HEURISTIC"
      : "NONE";

    try {
      const { primaryPolicy, randomizationSeed } =
        this.experiment.assignPolicy();
      const heuristicProposal = {
        scheduledStartTime: heuristicStart?.toISOString() ?? null,
      };

      const pick =
        primaryPolicy === SchedulingModel.LINUCB
          ? await this.bandit.placeTask(
              user.id,
              task,
              user.timezone,
              user.preferenceMatrix,
              now,
            )
          : null;

      this.logger.log(
        `schedule[${trigger}] session=${task.id} assignedPolicy=${primaryPolicy} ` +
          `applied=${pick ? "LINUCB" : heuristicStart ? "HEURISTIC" : "NONE"} ` +
          `heuristicProposal=${heuristicStart?.toISOString() ?? "none"} ` +
          `linucbProposal=${
            pick
              ? `${pick.scheduledStartTime.toISOString()} (arm=${pick.selectedArm})`
              : primaryPolicy === SchedulingModel.LINUCB
                ? "none"
                : "n/a (not primary)"
          }`,
      );

      if (pick) {
        await this.prisma.session.update({
          where: { id: task.id },
          data: { scheduledStartTime: pick.scheduledStartTime },
        });
        await this.experiment.recordProposal({
          userId: user.id,
          sessionId: task.id,
          trigger,
          primaryPolicy,
          randomizationSeed,
          heuristicProposal,
          proposedStartTime: pick.scheduledStartTime,
          modelProposal: {
            scheduledStartTime: pick.scheduledStartTime,
            selectedArm: pick.selectedArm,
          },
          featureVector: pick.featureVector,
          selectedArm: pick.selectedArm,
        });
        appliedStart = pick.scheduledStartTime;
        appliedPolicy = "LINUCB";
      } else {
        await this.experiment.recordProposal({
          userId: user.id,
          sessionId: task.id,
          trigger,
          primaryPolicy,
          randomizationSeed,
          heuristicProposal,
          proposedStartTime: heuristicStart,
          modelProposal: null,
          featureVector: [],
          selectedArm: null,
        });
      }
    } catch (err) {
      this.logger.warn(
        `scheduling experiment (${trigger}) failed for session ${task.id}: ${
          (err as Error).message
        }`,
      );
    }

    return { scheduledStartTime: appliedStart ?? null, appliedPolicy };
  }

  /**
   * Place every member of a freshly-created `TASK` series and persist the
   * placed `scheduledStartTime`s in one transaction. The caller has already
   * inserted the rows + `CREATE` events. Returns one row per member
   * (`null` start = nothing free fit).
   */
  async placeSeriesOnCreate(args: {
    user: User;
    seriesId: string;
    members: SeriesMemberInput[];
    deadline: Date;
    now: Date;
  }): Promise<SeriesPlacementRow[]> {
    const { user, seriesId, members, deadline, now } = args;

    const placements = await this.seriesPlacer.placeSeries(
      user.id,
      { members, deadline },
      user.timezone,
      user.preferenceMatrix,
      now,
      { trigger: "create" },
    );

    const placed = placements.filter((p) => p.scheduledStartTime).length;
    this.logger.log(
      `schedule[create-series] series=${seriesId} members=${members.length} placed=${placed}/${members.length}`,
    );

    await this.persistPlaced(placements);
    return placements;
  }

  /**
   * A `TASK` series' deadline moved: push the new `deadline` onto the series row
   * and every member, then re-run the series placement for the sittings that
   * have not started yet. Past sittings keep their slot and are held clear as
   * `fixedOccupied`. Returns one row per member in the given order.
   */
  async redistributeSeries(args: {
    user: User;
    seriesId: string;
    members: {
      id: string;
      durationMinutes: number;
      scheduledStartTime: Date | null;
    }[];
    newDeadline: Date;
    now: Date;
  }): Promise<SeriesPlacementRow[]> {
    const { user, seriesId, members, newDeadline, now } = args;

    const isPast = (s: { scheduledStartTime: Date | null }) =>
      s.scheduledStartTime != null &&
      s.scheduledStartTime.getTime() < now.getTime();
    const upcoming = members.filter((m) => !isPast(m));
    const fixedOccupied = members.filter(isPast).map((m) => ({
      start: (m.scheduledStartTime as Date).getTime(),
      end:
        (m.scheduledStartTime as Date).getTime() + m.durationMinutes * 60_000,
    }));

    const placements = await this.seriesPlacer.placeSeries(
      user.id,
      {
        members: upcoming.map((m) => ({
          id: m.id,
          durationMinutes: m.durationMinutes,
        })),
        deadline: newDeadline,
        fixedOccupied,
      },
      user.timezone,
      user.preferenceMatrix,
      now,
      { trigger: "deadline-change" },
    );
    const startById = new Map(
      placements.map((p) => [p.id, p.scheduledStartTime]),
    );

    await this.prisma.$transaction([
      this.prisma.sessionSeries.update({
        where: { id: seriesId },
        data: { deadline: newDeadline },
      }),
      this.prisma.session.updateMany({
        where: { seriesId, userId: user.id },
        data: { deadline: newDeadline },
      }),
      ...upcoming.map((m) =>
        this.prisma.session.update({
          where: { id: m.id },
          data: { scheduledStartTime: startById.get(m.id) ?? null },
        }),
      ),
    ]);

    return members.map((m) => ({
      id: m.id,
      scheduledStartTime: isPast(m)
        ? m.scheduledStartTime
        : (startById.get(m.id) ?? null),
    }));
  }

  private async persistPlaced(rows: SeriesPlacementRow[]): Promise<void> {
    const placed = rows.filter((p) => p.scheduledStartTime);
    if (placed.length === 0) return;
    await this.prisma.$transaction(
      placed.map((p) =>
        this.prisma.session.update({
          where: { id: p.id },
          data: { scheduledStartTime: p.scheduledStartTime },
        }),
      ),
    );
  }
}
