import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { KillSwitchService } from "../common/killswitch/killswitch.service";
import { OutboundBreakers } from "../common/outbound-breaker";
import { PushService } from "../devices/push.service";
import { QueueWorkers } from "../queue/queue-workers.service";
import { NOTIFY_QUEUE, type NotifyJobData } from "../queue/queues";
import { withBreaker } from "../queue/with-breaker";
import { ReminderSchedulerService } from "../reminders/reminder-scheduler.service";

/**
 * The `notify` queue consumer (role `worker-notify`, `worker`, `all`):
 * `push` (one provider per job) -> {@link PushService}, `reminder` ->
 * {@link ReminderSchedulerService.fire}. Each handler throws on a real failure
 * (BullMQ retries with backoff, then dead-letters) and returns normally when
 * there is nothing to send. Push providers run under the `fcm` / `apns`
 * breakers: when one is open the job is parked without using an attempt.
 */
@Injectable()
export class NotifyProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(
    private readonly workers: QueueWorkers,
    private readonly push: PushService,
    private readonly reminders: ReminderSchedulerService,
    private readonly breakers: OutboundBreakers,
    private readonly killSwitch: KillSwitchService,
  ) {}

  onModuleInit(): void {
    this.workers.register(NOTIFY_QUEUE, (job, token) =>
      this.process(job, token),
    );
  }

  async process(job: Job<NotifyJobData>, token?: string): Promise<void> {
    const data = job.data;
    // Kill switch: drop the job (no retry). The reminder sweep and
    // `reconcileRecent` re-arm anything still due once the flag is back on.
    if (!(await this.killSwitch.isEnabled("notifications"))) {
      this.logger.warn(`notifications disabled, dropping job ${job.id}`);
      return;
    }
    switch (data.type) {
      case "push":
        // One job per provider: a breaker park re-runs only that provider.
        if (!data.provider) {
          throw new UnrecoverableError(`push job ${job.id} has no provider`);
        }
        return this.push.deliver(data.notificationId, {
          provider: data.provider,
          guard: (provider, fn) =>
            withBreaker(this.breakers, provider, job, token, fn, {
              queue: NOTIFY_QUEUE.name,
            }),
        });
      case "reminder":
        return this.reminders.fire(
          data.reminderId,
          new Date(data.startsAt).getTime(),
        );
      default:
        this.logger.warn(`unknown notify job ${job.id}`);
    }
  }
}
