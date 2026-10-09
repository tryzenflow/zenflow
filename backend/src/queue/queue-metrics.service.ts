import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseRole, runsWatcher } from "../common/config/role";
import { queueDepth } from "../observability/metrics";
import { DLQ_MAX_AGE_MS } from "./queue.constants";
import { QueueService } from "./queue.service";
import { ALL_QUEUES } from "./queues";

export const QUEUE_DEPTH_POLL_MS = 15_000;
/** The DLQ age trim runs about hourly (every Nth poll). */
export const DLQ_TRIM_EVERY_POLLS = 240;

/**
 * Publishes `queue.depth` (waiting, delayed, active, failed, dlq per queue).
 * Polled from one place, the watcher (or `worker`/`all`), so replicas do not
 * multiply the series. Skipped without a queue Redis.
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMetricsService.name);
  private timer?: NodeJS.Timeout;
  private polls = 0;

  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.queues.memory) return;
    if (!runsWatcher(parseRole(this.config.get<string>("ROLE")))) return;
    this.timer = setInterval(() => void this.poll(), QUEUE_DEPTH_POLL_MS);
    this.timer.unref();
  }

  async poll(): Promise<void> {
    const trim = this.polls++ % DLQ_TRIM_EVERY_POLLS === 0;
    for (const def of ALL_QUEUES) {
      try {
        const counts = await this.queues.counts(def);
        for (const [state, value] of Object.entries<number>({ ...counts })) {
          queueDepth.record(value, { queue: def.name, state });
        }
      } catch (err) {
        this.logger.debug(`depth poll ${def.name}: ${(err as Error).message}`);
      }
      if (!trim) continue;
      try {
        await this.queues.trimDlq(def, DLQ_MAX_AGE_MS);
      } catch (err) {
        this.logger.debug(`dlq trim ${def.name}: ${(err as Error).message}`);
      }
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
