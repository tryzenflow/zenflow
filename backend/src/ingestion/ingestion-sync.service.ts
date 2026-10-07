import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IntegrationProvider } from "@zenflow/shared";
import { LMSService } from "../lms/lms.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { ExamWatcherService } from "./exam-watcher.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";
import {
  eachIntegrationTarget,
  isIngestionEnabled,
  type IntegrationTarget,
  type PassOutcome,
} from "./watcher-support";

/**
 * What a manual run did. `complete` is false when any pass failed — including
 * one that never got a token — even if another pass succeeded, so a healthy
 * exam call cannot mask a portal login that did not work.
 */
export interface ManualSyncOutcome {
  synced: SyncedKind[];
  complete: boolean;
}

/** Schedule kinds, as `IngestionScheduleService.deferAfterManualSync` takes them. */
export type SyncedKind =
  | "PORTAL_DISCOVERY"
  | "PORTAL_TIMETABLE"
  | "PORTAL_EXAM"
  | "LMS_CALENDAR";

/**
 * The manual `POST /integrations/:provider/sync` trigger, in one place.
 *
 * It runs the *same* `run(now, userId)` the crons run, narrowed to one
 * student — there is deliberately no second, "manual" code path that could
 * drift from what the background sweep actually does. That also means the
 * trigger writes the same job rows, which is the whole point: it is how
 * `IntegrationStatus.lastSyncedAt` / `.lastSyncStatus` become observable
 * without waiting up to an hour for the next tick.
 *
 * Existing to keep the unavoidable `IntegrationsModule` ↔ `IngestionModule`
 * cycle down to a single `forwardRef` seam, and to hold the one asymmetry
 * between the providers: `PORTAL` covers two upstream endpoints, so it runs two
 * watchers.
 */
@Injectable()
export class IngestionSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lmsWatcher: LmsWatcherService,
    private readonly timetableWatcher: TimetableWatcherService,
    private readonly examWatcher: ExamWatcherService,
    private readonly lmsClient: LMSService,
    private readonly portalClient: PortalAPIService,
  ) {}

  /**
   * Ms until `provider`'s upstream circuit breaker may admit a call, or `null`
   * when it can. A non-consuming peek, used to refuse a manual sync up front.
   */
  upstreamUnavailableFor(provider: IntegrationProvider): number | null {
    return provider === "LMS"
      ? this.lmsClient.unavailableFor()
      : this.portalClient.unavailableFor();
  }

  /**
   * Run one student's watchers for `provider` and resolve once they are done,
   * so the caller can read back a `lastSyncStatus` that reflects this run.
   *
   * Resolves with the schedule kinds whose pass came back clean — what the
   * caller may push out by a period — and whether every pass did.
   * A kind that failed is left out so the rolling ticker retries it on schedule.
   *
   * The two portal watchers run one after the other rather than concurrently:
   * they hit the same portal on behalf of the same student, and sequential
   * outbound requests are the baseline's entire politeness policy.
   */
  async syncNow(
    userId: string,
    provider: IntegrationProvider,
    now = new Date(),
  ): Promise<ManualSyncOutcome> {
    if (!isIngestionEnabled(this.config))
      return { synced: [], complete: false };
    const pass = (run: (target: IntegrationTarget) => Promise<PassOutcome>) =>
      this.passFor(provider, userId, run);

    if (provider === "LMS") {
      const ok = await pass((t) => this.lmsWatcher.syncOne(t, now));
      return { synced: ok ? ["LMS_CALENDAR"] : [], complete: ok };
    }
    const synced: SyncedKind[] = [];
    // A clean timetable pass implies discovery covered the term: it is the gate.
    const timetableOk = await pass((t) =>
      this.timetableWatcher.syncOne(t, now),
    );
    if (timetableOk) synced.push("PORTAL_DISCOVERY", "PORTAL_TIMETABLE");
    const examOk = await pass((t) => this.examWatcher.syncOne(t, now));
    if (examOk) synced.push("PORTAL_EXAM");
    return { synced, complete: timetableOk && examOk };
  }

  /** True when the student's pass ran and every upstream request succeeded. */
  private async passFor(
    provider: IntegrationProvider,
    userId: string,
    run: (target: IntegrationTarget) => Promise<PassOutcome>,
  ): Promise<boolean> {
    let ok = false;
    await eachIntegrationTarget(
      this.prisma,
      provider,
      userId,
      async (target) => {
        ok = (await run(target)).ok;
      },
    );
    return ok;
  }
}
