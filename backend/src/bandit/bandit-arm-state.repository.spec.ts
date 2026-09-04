import { BanditArmStateRepository } from "./bandit-arm-state.repository";

function make(overrides: Record<string, unknown> = {}) {
  const prisma = {
    banditArmState: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      ...overrides,
    },
  };
  return { repo: new BanditArmStateRepository(prisma as never), prisma };
}

describe("BanditArmStateRepository.loadAll", () => {
  it("fills every missing arm with the cold prior", async () => {
    const { repo } = make();
    const out = await repo.loadAll("u1");
    expect(Object.keys(out).sort()).toEqual(
      ["AFTERNOON", "EARLY_MORNING", "EVENING", "MORNING", "NIGHT"].sort(),
    );
    expect(out.MORNING).toEqual({ A: [], b: [], version: 0 });
  });

  it("returns the stored state for arms that have a row", async () => {
    const { repo } = make({
      findMany: jest
        .fn()
        .mockResolvedValue([
          { arm: "NIGHT", A: [1, 0, 0, 1], b: [2, 3], version: 5 },
        ]),
    });
    const out = await repo.loadAll("u1");
    expect(out.NIGHT).toEqual({ A: [1, 0, 0, 1], b: [2, 3], version: 5 });
    expect(out.MORNING.version).toBe(0);
  });
});

describe("BanditArmStateRepository.save", () => {
  it("updates in place when the version guard matches", async () => {
    const { repo, prisma } = make({
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });
    await repo.save("u1", "NIGHT", [1], [2], 4);
    expect(prisma.banditArmState.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", arm: "NIGHT", version: 4 },
      data: { A: [1], b: [2], version: 5 },
    });
    expect(prisma.banditArmState.create).not.toHaveBeenCalled();
  });

  it("creates the row on the first write (prevVersion 0, no match)", async () => {
    const { repo, prisma } = make();
    await repo.save("u1", "MORNING", [1], [2], 0);
    expect(prisma.banditArmState.create).toHaveBeenCalledWith({
      data: { userId: "u1", arm: "MORNING", A: [1], b: [2], version: 1 },
    });
  });

  it("is a no-op (never throws) when another writer moved the version ahead", async () => {
    const { repo, prisma } = make();
    await expect(
      repo.save("u1", "NIGHT", [1], [2], 9),
    ).resolves.toBeUndefined();
    expect(prisma.banditArmState.create).not.toHaveBeenCalled();
  });

  it("swallows a create race error", async () => {
    const { repo } = make({
      create: jest.fn().mockRejectedValue(new Error("unique constraint")),
    });
    await expect(
      repo.save("u1", "NIGHT", [1], [2], 0),
    ).resolves.toBeUndefined();
  });
});
