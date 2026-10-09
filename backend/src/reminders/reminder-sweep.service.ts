import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Logger } from "@nestjs/common";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ReminderSchedulerService } from "./reminder-scheduler.service";

/**
 * Watcher-only (ADR-0011): arms reminder jobs at boot and every 5 minutes.
 * Lives apart from {@link ReminderSchedulerService} so the notify worker, which
 * only fires reminders, runs no sweep.
 */

@Injectable()
export class ReminderSweepService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReminderSweepService.name);

  constructor(
    private readonly scheduler: ReminderSchedulerService,
    private readonly notifications: NotificationsService,
    private readonly killSwitch: KillSwitchService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduler.sweep();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!(await this.killSwitch.isEnabled("notifications"))) return;
    await this.scheduler.sweep();
    // Also repairs pushes whose enqueue was dropped (any notification row).
    try {
      const n = await this.notifications.reconcileRecent();
      if (n > 0) this.logger.warn(`re-enqueued ${n} lost push job(s)`);
    } catch (err) {
      this.logger.warn(`notify reconcile failed: ${(err as Error).message}`);
    }
  }
}
