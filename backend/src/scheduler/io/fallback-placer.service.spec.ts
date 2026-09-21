import { FallbackPlacer } from "./fallback-placer.service";

const tz = "UTC";
const now = new Date("2026-06-08T08:00:00.000Z");
const deadline = new Date("2026-06-11T00:00:00.000Z");

function make(placeInWindow: jest.Mock) {
  const heuristic = { placeTask: jest.fn(), placeInWindow };
  return { fb: new FallbackPlacer(heuristic as never), heuristic };
}

const slotAt = (iso: string) => ({ start: new Date(iso), score: 1 });

describe("FallbackPlacer (frozen heuristic, ADR-0003)", () => {
  it("placeSingle delegates to the heuristic and never displaces or accepts conflicts", async () => {
    const { fb, heuristic } = make(jest.fn());
    heuristic.placeTask.mockResolvedValue(null);
    const t = { id: "t", durationMinutes: 60, deadline };
    expect(await fb.placeSingle("u", t, tz, [], now)).toBeNull();
    expect(heuristic.placeTask).toHaveBeenCalledWith("u", t, tz, [], now);
  });

  it("series: clamps each member to its own day-window, one per day, siblings blocked", async () => {
    const place = jest
      .fn()
      .mockResolvedValueOnce(slotAt("2026-06-08T09:00:00.000Z"))
      .mockResolvedValueOnce(slotAt("2026-06-09T09:00:00.000Z"));
    const { fb } = make(place);
    const rows = await fb.placeSeries(
      "u",
      {
        members: [
          { id: "a", durationMinutes: 60 },
          { id: "b", durationMinutes: 60 },
        ],
        deadline,
      },
      tz,
      [],
      now,
    );
    expect(rows.map((r) => r.scheduledStartTime?.toISOString())).toEqual([
      "2026-06-08T09:00:00.000Z",
      "2026-06-09T09:00:00.000Z",
    ]);
    // Windows never overlap between members.
    const w0 = (place.mock.calls as unknown[][])[0][5] as {
      firstDayStr: string;
      lastDayStr: string;
    };
    const w1 = (place.mock.calls as unknown[][])[1][5] as {
      firstDayStr: string;
      lastDayStr: string;
    };
    expect(w0.lastDayStr < w1.firstDayStr).toBe(true);
    // The second member schedules around the first sibling.
    const opts1 = (place.mock.calls as unknown[][])[1][6] as {
      extraOccupied: { start: number; end: number }[];
      skipDay: (d: string) => boolean;
    };
    expect(opts1.extraOccupied).toEqual([
      {
        start: Date.parse("2026-06-08T09:00:00.000Z"),
        end: Date.parse("2026-06-08T10:00:00.000Z"),
      },
    ]);
    expect(opts1.skipDay("2026-06-08")).toBe(true); // MAX_SERIES_PER_DAY = 1
  });

  it("series: a member with no slot comes back null (caller enforces all-or-nothing)", async () => {
    const place = jest
      .fn()
      .mockResolvedValueOnce(slotAt("2026-06-08T09:00:00.000Z"))
      .mockResolvedValueOnce(null);
    const { fb } = make(place);
    const rows = await fb.placeSeries(
      "u",
      {
        members: [
          { id: "a", durationMinutes: 60 },
          { id: "b", durationMinutes: 60 },
        ],
        deadline,
      },
      tz,
      [],
      now,
    );
    expect(rows[1].scheduledStartTime).toBeNull();
  });

  it("returns all-null rows when the deadline has passed", async () => {
    const { fb } = make(jest.fn());
    const rows = await fb.placeSeries(
      "u",
      { members: [{ id: "a", durationMinutes: 60 }], deadline: now },
      tz,
      [],
      now,
    );
    expect(rows).toEqual([{ id: "a", scheduledStartTime: null }]);
  });
});
