import type { User } from "../../../generated/prisma";
import { ScheduleInfeasibleException } from "../schedule-infeasible.exception";
import { wouldConflict } from "./conflict-check";
import { ConflictRescheduleService } from "./conflict-reschedule.service";

jest.mock("./conflict-check", () => ({ wouldConflict: jest.fn() }));
const conflicts = wouldConflict as jest.MockedFunction<typeof wouldConflict>;

const user = { id: "u1", timezone: "UTC" } as unknown as User;
const now = new Date("2026-06-08T00:00:00.000Z");
const deadline = new Date("2026-06-30T00:00:00.000Z");
const at = (iso: string) => new Date(iso);

const row = (id: string, start: string, seriesId: string | null = null) => ({
  id,
  seriesId,
  durationMinutes: 60,
  deadline,
  scheduledStartTime: at(start),
});

type Move = { id: string; fromMs: number; toMs: number };

function make(rows: ReturnType<typeof row>[]) {
  const prisma = {
    session: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(rows)
        .mockResolvedValue(
          rows.map((r) => ({ id: r.id, durationMinutes: 60 })),
        ),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const placement = {
    placeOnDeadlineChange: jest.fn(),
    planSeriesRespread: jest.fn(),
  };
  const displacement = {
    applyMoves: jest.fn((_u: string, moves: Move[]) =>
      Promise.resolve(
        moves.map((m) => ({
          id: m.id,
          from: new Date(m.fromMs),
          to: new Date(m.toMs),
        })),
      ),
    ),
  };
  const svc = new ConflictRescheduleService(
    prisma as never,
    placement as never,
    displacement as never,
  );
  return { svc, prisma, placement, displacement };
}

beforeEach(() => {
  conflicts.mockReset();
  conflicts.mockResolvedValue(true);
});

describe("ConflictRescheduleService.rescheduleAll", () => {
  it("moves a lone conflicting task through single placement", async () => {
    const { svc, placement, displacement } = make([
      row("t", "2026-06-09T09:00:00.000Z"),
    ]);
    const to = at("2026-06-09T13:00:00.000Z");
    placement.placeOnDeadlineChange.mockResolvedValue({
      scheduledStartTime: to,
    });

    const res = await svc.rescheduleAll(user, ["t"], now);

    expect(res.rescheduled).toEqual([
      { id: "t", from: at("2026-06-09T09:00:00.000Z"), to },
    ]);
    expect(displacement.applyMoves).toHaveBeenCalledTimes(1);
    expect(placement.planSeriesRespread).not.toHaveBeenCalled();
  });

  it("re-spreads a series' conflicting sittings in ONE call (no lone-task placements)", async () => {
    const { svc, placement, displacement } = make([
      row("a", "2026-06-09T09:00:00.000Z", "s1"),
      row("b", "2026-06-11T09:00:00.000Z", "s1"),
      row("c", "2026-06-13T09:00:00.000Z", "s1"),
    ]);
    placement.planSeriesRespread.mockResolvedValue([
      {
        id: "a",
        from: at("2026-06-09T09:00:00.000Z"),
        to: at("2026-06-09T14:00:00.000Z"),
      },
      {
        id: "b",
        from: at("2026-06-11T09:00:00.000Z"),
        to: at("2026-06-12T14:00:00.000Z"),
      },
      {
        id: "c",
        from: at("2026-06-13T09:00:00.000Z"),
        to: at("2026-06-15T14:00:00.000Z"),
      },
      // Unchanged sibling: not a move.
      {
        id: "d",
        from: at("2026-06-17T09:00:00.000Z"),
        to: at("2026-06-17T09:00:00.000Z"),
      },
    ]);

    const res = await svc.rescheduleAll(user, ["a", "b", "c"], now);

    expect(placement.planSeriesRespread).toHaveBeenCalledTimes(1);
    expect(placement.planSeriesRespread).toHaveBeenCalledWith({
      user,
      seriesId: "s1",
      deadline,
      now,
    });
    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
    const moves = displacement.applyMoves.mock.calls[0][1];
    expect(moves.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(res.rescheduled.map((r) => r.to.toISOString())).toEqual([
      "2026-06-09T14:00:00.000Z",
      "2026-06-12T14:00:00.000Z",
      "2026-06-15T14:00:00.000Z",
    ]);
    expect(res.failedSessionIds).toEqual([]);
  });

  it("falls back to single placement when the respread leaves a sitting unplaced", async () => {
    const { svc, placement, displacement } = make([
      row("a", "2026-06-09T09:00:00.000Z", "s1"),
    ]);
    placement.planSeriesRespread.mockResolvedValue([
      { id: "a", from: at("2026-06-09T09:00:00.000Z"), to: null },
    ]);
    placement.placeOnDeadlineChange.mockResolvedValue({
      scheduledStartTime: at("2026-06-10T09:00:00.000Z"),
    });

    const res = await svc.rescheduleAll(user, ["a"], now);

    expect(placement.placeOnDeadlineChange).toHaveBeenCalledTimes(1);
    expect(displacement.applyMoves).toHaveBeenCalledTimes(1);
    expect(res.rescheduled).toHaveLength(1);
  });

  it("one task that can't be placed is reported, the rest still move", async () => {
    const { svc, placement } = make([
      row("x", "2026-06-09T09:00:00.000Z"),
      row("y", "2026-06-10T09:00:00.000Z"),
    ]);
    placement.placeOnDeadlineChange
      .mockRejectedValueOnce(new ScheduleInfeasibleException())
      .mockResolvedValueOnce({
        scheduledStartTime: at("2026-06-10T13:00:00.000Z"),
      });

    const res = await svc.rescheduleAll(user, ["x", "y"], now);

    expect(res.failedSessionIds).toEqual(["x"]);
    expect(res.rescheduled.map((r) => r.id)).toEqual(["y"]);
  });

  it("leaves tasks that no longer conflict alone", async () => {
    conflicts.mockResolvedValue(false);
    const { svc, placement, displacement } = make([
      row("t", "2026-06-09T09:00:00.000Z", "s1"),
    ]);

    const res = await svc.rescheduleAll(user, ["t"], now);

    expect(res).toEqual({ rescheduled: [], failedSessionIds: [] });
    expect(placement.planSeriesRespread).not.toHaveBeenCalled();
    expect(placement.placeOnDeadlineChange).not.toHaveBeenCalled();
    expect(displacement.applyMoves).not.toHaveBeenCalled();
  });
});
