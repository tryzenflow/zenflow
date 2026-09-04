import { PREFERENCE_MATRIX_LENGTH } from "@zenflow/shared";
import { MatrixDecayService } from "./matrix-decay.service";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Coverage for the I/O wrapper around the PURE decay helper. We assert the
 * orchestration: which rows get decayed vs only time-stamped, and that the
 * matrix + `preferenceMatrixDecayedAt` are written back. The decay MATH itself
 * is covered by the ml-engineer's `matrix-decay.spec.ts` (pure helper).
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
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const prisma = {
    user: {
      findMany: jest.fn(async () => rows),
      update: jest.fn(async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return { id: where.id, ...data };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, updates };
}

describe("MatrixDecayService.decayAll", () => {
  const now = new Date("2026-06-20T03:00:00.000Z");

  it("only stamps the time on first sight (null lastDecayedAt)", async () => {
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: fullMatrix(),
        preferenceMatrixDecayedAt: null,
      },
    ]);
    const svc = new MatrixDecayService(prisma);
    const count = await svc.decayAll(now);

    expect(count).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({ preferenceMatrixDecayedAt: now });
    // no matrix written on first sight
    expect(updates[0].data.preferenceMatrix).toBeUndefined();
  });

  it("only stamps the time when the matrix is the wrong length", async () => {
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: [1, 2, 3],
        preferenceMatrixDecayedAt: new Date("2026-06-01T03:00:00.000Z"),
      },
    ]);
    const svc = new MatrixDecayService(prisma);
    const count = await svc.decayAll(now);

    expect(count).toBe(0);
    expect(updates[0].data.preferenceMatrix).toBeUndefined();
    expect(updates[0].data.preferenceMatrixDecayedAt).toEqual(now);
  });

  it("decays + restamps a row with a prior decay and full matrix", async () => {
    const last = new Date("2026-05-30T03:00:00.000Z"); // 21 days earlier
    const { prisma, updates } = makePrisma([
      {
        id: "u1",
        preferenceMatrix: fullMatrix(100),
        preferenceMatrixDecayedAt: last,
      },
    ]);
    const svc = new MatrixDecayService(prisma);
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
    const svc = new MatrixDecayService(prisma);
    const count = await svc.decayAll(now);
    expect(count).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
