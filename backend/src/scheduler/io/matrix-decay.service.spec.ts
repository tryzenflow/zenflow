import { Test, TestingModule } from "@nestjs/testing";
import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { MatrixDecayService } from "./matrix-decay.service";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Coverage for the I/O wrapper around the PURE decay helper. We assert the
 * orchestration: which rows get decayed vs only time-stamped, and that the
 * matrix + `preferenceMatrixDecayedAt` are written back. The decay MATH itself
 * is covered by the ml-engineer's `matrix-decay.spec.ts` (pure helper).
 *
 * The per-row read-modify-write now goes through a row-locked
 * `SELECT ... FOR UPDATE` (`withLockedPreferenceMatrix`, Item 3B3's
 * concurrency guard) — `tx.$queryRaw` stands in for that fresh, locked read;
 * it's seeded from the SAME per-user row data as `findMany` here (no
 * concurrent writer in these tests), and `tx.user.update` stands in for the
 * write inside that same transaction.
 */

function fullMatrix(value = 100): number[] {
  return new Array<number>(PREFERENCE_MATRIX_LENGTH).fill(value);
}

interface UserRow {
  id: string;
  preferenceMatrix: number[];
  preferenceMatrixDecayedAt: Date | null;
}

function makePrisma(rows: UserRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  const txUserUpdate = jest.fn(
    ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      updates.push({ id: where.id, data });
      return Promise.resolve({ id: where.id, ...data });
    },
  );

  const prisma = {
    user: {
      findMany: jest.fn(() => Promise.resolve(rows)),
      // Only ever hit for the "first sight" (no prior decay timestamp) path,
      // which never touches `preferenceMatrix` and so needs no row lock.
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          return Promise.resolve({ id: where.id, ...data });
        },
      ),
    },
    $transaction: (
      fn: (tx: {
        $queryRaw: (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<UserRow[]>;
        user: { update: typeof txUserUpdate };
      }) => unknown,
    ) =>
      fn({
        $queryRaw: (_strings, ...values) => {
          const userId = values[0] as string;
          const row = byId.get(userId);
          return Promise.resolve(row ? [row] : []);
        },
        user: { update: txUserUpdate },
      }),
  } as unknown as PrismaService;
  return { prisma, updates };
}

async function makeService(prisma: PrismaService): Promise<MatrixDecayService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MatrixDecayService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return module.get<MatrixDecayService>(MatrixDecayService);
}

describe("MatrixDecayService.decayAll", () => {
  const now = new Date("2026-06-20T03:00:00.000Z");

  it("only stamps the time on first sight (null lastDecayedAt), no lock needed", async () => {
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: fullMatrix(),
        preferenceMatrixDecayedAt: null,
      },
    ]);
    const svc = await makeService(prisma);
    const count = await svc.decayAll(now);

    expect(count).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({ preferenceMatrixDecayedAt: now });
    // no matrix written on first sight
    expect(updates[0].data.preferenceMatrix).toBeUndefined();
  });

  it("only stamps the time when the (freshly re-read, locked) matrix is the wrong length", async () => {
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: [1, 2, 3],
        preferenceMatrixDecayedAt: new Date("2026-06-01T03:00:00.000Z"),
      },
    ]);
    const svc = await makeService(prisma);
    const count = await svc.decayAll(now);

    expect(count).toBe(0);
    expect(updates[0].data.preferenceMatrix).toBeUndefined();
    expect(updates[0].data.preferenceMatrixDecayedAt).toEqual(now);
  });

  it("decays + restamps a row with a prior decay and full matrix, under the row lock", async () => {
    const last = new Date("2026-05-30T03:00:00.000Z"); // 21 days earlier
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: fullMatrix(100),
        preferenceMatrixDecayedAt: last,
      },
    ]);
    const svc = await makeService(prisma);
    const count = await svc.decayAll(now);

    expect(count).toBe(1);
    const written = updates[0].data as {
      preferenceMatrix: number[];
      preferenceMatrixDecayedAt: Date;
    };
    expect(written.preferenceMatrixDecayedAt).toEqual(now);
    expect(written.preferenceMatrix).toHaveLength(PREFERENCE_MATRIX_LENGTH);
    // ~21 days at a 21-day half-life ≈ halved (100 → ~50). The exact rounding is
    // the pure helper's contract; here we just assert it shrank toward zero.
    expect(written.preferenceMatrix[0]).toBeLessThan(100);
    expect(written.preferenceMatrix[0]).toBeGreaterThan(0);
  });

  it("skips a row already decayed today (Δdays <= 0)", async () => {
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: fullMatrix(),
        preferenceMatrixDecayedAt: now,
      },
    ]);
    const svc = await makeService(prisma);
    const count = await svc.decayAll(now);
    expect(count).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
