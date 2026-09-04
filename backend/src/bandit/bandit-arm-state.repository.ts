import { Injectable, Logger } from "@nestjs/common";
import { SCHEDULING_ARMS, type SchedulingArm } from "@zenflow/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { LoadedArmState } from "./bandit.types";

/**
 * Load / persist per-(user, arm) LinUCB `(A, b)` for the stateless Python
 * bandit service. `save` is best-effort optimistic-concurrency: a concurrent
 * writer that bumped `version` first simply wins and this call is a no-op
 * (logged, never thrown) — a lost bandit update is acceptable.
 */
@Injectable()
export class BanditArmStateRepository {
  private readonly logger = new Logger(BanditArmStateRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /** All 5 arms for a user; arms with no row yet come back as the cold prior. */
  async loadAll(
    userId: string,
  ): Promise<Record<SchedulingArm, LoadedArmState>> {
    const rows = await this.prisma.banditArmState.findMany({
      where: { userId },
    });
    const byArm = new Map(rows.map((r) => [r.arm, r]));

    const out = {} as Record<SchedulingArm, LoadedArmState>;
    for (const arm of SCHEDULING_ARMS) {
      const row = byArm.get(arm);
      out[arm] = row
        ? { A: row.A, b: row.b, version: row.version }
        : { A: [], b: [], version: 0 };
    }
    return out;
  }

  /**
   * Persist a new `(A, b)` for one arm. Guards on `prevVersion` so a stale
   * update can't clobber a newer one; on a version mismatch (or first-write
   * race) it logs and returns without throwing.
   */
  async save(
    userId: string,
    arm: SchedulingArm,
    A: number[],
    b: number[],
    prevVersion: number,
  ): Promise<void> {
    try {
      const updated = await this.prisma.banditArmState.updateMany({
        where: { userId, arm, version: prevVersion },
        data: { A, b, version: prevVersion + 1 },
      });
      if (updated.count > 0) return;

      // No row matched the guard: either the row doesn't exist yet
      // (prevVersion 0) or another writer moved ahead. Try to create; a
      // unique-constraint failure means we lost the race — accept it.
      if (prevVersion === 0) {
        await this.prisma.banditArmState.create({
          data: { userId, arm, A, b, version: 1 },
        });
        return;
      }

      this.logger.warn(
        `bandit state save skipped for user=${userId} arm=${arm}: version moved past ${prevVersion}`,
      );
    } catch (err) {
      this.logger.warn(
        `bandit state save failed for user=${userId} arm=${arm}: ${(err as Error).message}`,
      );
    }
  }
}
