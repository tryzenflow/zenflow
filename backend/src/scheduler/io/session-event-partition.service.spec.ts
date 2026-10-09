import { Test } from "@nestjs/testing";
import { SessionEventPartitionService } from "./session-event-partition.service";
import { PrismaService } from "../../prisma/prisma.service";

const NOW = new Date("2026-10-09T12:00:00Z");

async function makeSvc(listings: string[][]) {
  const queryRaw = jest.fn();
  for (const names of listings) {
    queryRaw.mockResolvedValueOnce(names.map((name) => ({ name })));
  }
  const executeRawUnsafe = jest
    .fn<Promise<number>, [string]>()
    .mockResolvedValue(0);
  const module = await Test.createTestingModule({
    providers: [
      SessionEventPartitionService,
      {
        provide: PrismaService,
        useValue: { $queryRaw: queryRaw, $executeRawUnsafe: executeRawUnsafe },
      },
    ],
  }).compile();
  return { svc: module.get(SessionEventPartitionService), executeRawUnsafe };
}

describe("SessionEventPartitionService", () => {
  it("creates missing future partitions and drops expired ones", async () => {
    const { svc, executeRawUnsafe } = await makeSvc([
      ["SessionEvent_2025_08", "SessionEvent_2026_10"],
      ["SessionEvent_2026_10", "SessionEvent_2026_11", "SessionEvent_2026_12"],
    ]);

    await svc.run(NOW);

    const sql = executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(sql).toEqual([
      `CREATE TABLE IF NOT EXISTS "SessionEvent_2026_11" PARTITION OF "SessionEvent" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01')`,
      `CREATE TABLE IF NOT EXISTS "SessionEvent_2026_12" PARTITION OF "SessionEvent" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01')`,
      `DROP TABLE IF EXISTS "SessionEvent_2025_08"`,
    ]);
  });

  it("does nothing when the window is already correct", async () => {
    const all = [
      "SessionEvent_2026_10",
      "SessionEvent_2026_11",
      "SessionEvent_2026_12",
    ];
    const { svc, executeRawUnsafe } = await makeSvc([all, all]);

    await svc.run(NOW);

    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });
});
