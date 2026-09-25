import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { PlaceContractFixture, PlacedMember } from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { FallbackPlacer } from "./fallback-placer.service";
import { HeuristicPlacer } from "./heuristic-placer.service";
import { PlacementGateway } from "./placement-gateway.service";

/**
 * Contract fixtures (`packages/shared/contract/place/*.json`, ADR-0003 section
 * 5). The Python side asserts `/v1/place(request) == response`; here Nest
 * asserts (a) the frozen TS heuristic agrees with every fixture's heuristic
 * pick (which is the hand-check evidence for the fixtures themselves) and (b)
 * `PlacementGateway.buildRequest` produces the fixture's request for the
 * equivalent seeded calendar.
 */
const DIR = join(__dirname, "../../../../packages/shared/contract/place");
const fixtures: PlaceContractFixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map(
    (f) =>
      JSON.parse(readFileSync(join(DIR, f), "utf8")) as PlaceContractFixture,
  );

function prismaFor(f: PlaceContractFixture) {
  const rows = [
    ...f.request.days.flatMap((d) => d.occupied),
    ...f.request.fixedOccupied,
  ].map((o, i) => ({
    id: `occ-${i}`,
    type: "DND",
    seriesId: null,
    scheduledStartTime: new Date(o.startMs),
    durationMinutes: (o.endMs - o.startMs) / 60_000,
    deadline: null,
  }));
  return {
    session: { findMany: jest.fn().mockResolvedValue(rows) },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
    sessionEvent: { count: jest.fn().mockResolvedValue(0) },
  };
}

const userOf = (f: PlaceContractFixture) =>
  ({
    id: "u1",
    timezone: f.request.timezone,
    preferenceMatrix: f.request.user.preferenceMatrix,
  }) as unknown as User;

describe("placement contract fixtures", () => {
  it("has the hand-checked fixture set", () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual(
      expect.arrayContaining([
        "series-two-members-heuristic",
        "single-heuristic-placed",
        "single-infeasible-second-call",
        "single-needs-infeasible-context",
      ]),
    );
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s: response is one result per member in order",
    (_name, f) => {
      expect(f.response.results.map((r) => r.id)).toEqual(
        f.request.members.map((m) => m.id),
      );
      expect(f.response.contractVersion).toBe(f.request.contractVersion);
    },
  );

  it.each(
    fixtures
      .filter(
        (f) =>
          !f.request.infeasible &&
          f.request.members.every((m) => m.primaryPolicy === "HEURISTIC"),
      )
      .map((f) => [f.name, f] as const),
  )(
    "%s: frozen TS heuristic agrees with the fixture picks",
    async (_name, f) => {
      const prisma = prismaFor(f);
      const heuristic = new HeuristicPlacer(prisma as never);
      const fallback = new FallbackPlacer(heuristic);
      const user = userOf(f);
      const now = new Date(f.request.nowMs);
      const deadline = new Date(f.request.deadlineMs);
      const expected = f.response.results;

      const rows = await fallback.placeSeries(
        user.id,
        {
          members: f.request.members.map((m) => ({
            id: m.id,
            durationMinutes: m.durationMinutes,
          })),
          deadline,
          fixedOccupied: f.request.fixedOccupied.map((o) => ({
            start: o.startMs,
            end: o.endMs,
          })),
        },
        user.timezone,
        user.preferenceMatrix,
        now,
      );
      rows.forEach((row, i) => {
        const want: PlacedMember = expected[i];
        const wantMs =
          want.outcome === "PLACED" ? (want.heuristic?.startMs ?? null) : null;
        expect(row.scheduledStartTime?.getTime() ?? null).toBe(wantMs);
      });
    },
  );

  it("single-heuristic-placed: gateway builds exactly the fixture request", async () => {
    const f = fixtures.find((x) => x.name === "single-heuristic-placed");
    if (!f) throw new Error("fixture missing");
    const gateway = new PlacementGateway(
      prismaFor(f) as never,
      {} as never,
      { loadAll: jest.fn() } as never,
    );
    const built = await gateway.buildRequest({
      user: userOf(f),
      members: f.request.members,
      deadline: new Date(f.request.deadlineMs),
      now: new Date(f.request.nowMs),
      mode: "PLACE",
      maxScanDays: f.request.maxScanDays,
      excludeSessionIds: [],
    });
    expect({ ...built, requestId: "x" }).toEqual({
      ...f.request,
      requestId: "x",
    });
  });
});
