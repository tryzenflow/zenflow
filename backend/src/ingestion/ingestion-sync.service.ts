import { Injectable } from "@nestjs/common";
import type { IntegrationProvider } from "@zenflow/shared";
import { ExamWatcherService } from "./exam-watcher.service";
import { LmsWatcherService } from "./lms-watcher.service";
import { TimetableWatcherService } from "./timetable-watcher.service";

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
    private readonly lmsWatcher: LmsWatcherService,
    private readonly timetableWatcher: TimetableWatcherService,
    private readonly examWatcher: ExamWatcherService,
  ) {}

  /**
   * Run one student's watchers for `provider` and resolve once they are done,
   * so the caller can read back a `lastSyncStatus` that reflects this run.
   *
   * The two portal watchers run one after the other rather than concurrently:
   * they hit the same portal on behalf of the same student, and sequential
   * outbound requests are the baseline's entire politeness policy.
   */
  async syncNow(
    userId: string,
    provider: IntegrationProvider,
    now = new Date(),
  ): Promise<void> {
    if (provider === "LMS") {
      await this.lmsWatcher.run(now, userId);
      return;
    }
    await this.timetableWatcher.run(now, userId);
    await this.examWatcher.run(now, userId);
  }
}
