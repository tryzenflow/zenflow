import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import Redis, { type RedisOptions } from "ioredis";
import type { Notification } from "../../generated/prisma";
import { parseRole, runsHttp } from "../common/config/role";
import {
  ssePubsubDelivered,
  ssePubsubPublished,
  ssePubsubSubscribers,
} from "../observability/metrics";

/**
 * Redis channel carrying `{ event, id, row }` JSON for every raised
 * notification. `id` is the notification id: delivery is at-most-once from
 * Redis but a local fallback emit or a re-announce (reconciliation sweep) can
 * repeat an event, so SSE clients must dedupe by `id` (web and mobile do).
 */
export const NOTIFICATION_CHANNEL = "zenflow:notifications";

const DATE_FIELDS = [
  "sentAt",
  "readAt",
  "actionTakenAt",
  "eventEndsAt",
] as const;

/** JSON turns the row's `Date`s into strings; turn them back for the DTO mapper. */
export function reviveNotification(raw: Record<string, unknown>): Notification {
  const row = { ...raw };
  for (const f of DATE_FIELDS) {
    if (typeof row[f] === "string") row[f] = new Date(row[f]);
  }
  return row as unknown as Notification;
}

/**
 * SSE fan-out across processes (ADR-0018, #133).
 *
 * `publish()` sends a notification event to the dedicated pub/sub Redis
 * (`REDIS_PUBSUB_URL`); every process that serves HTTP subscribes once and
 * re-emits into the local `emitter` that `GET /notifications/stream` reads, so
 * a row raised by a worker or another API replica reaches the client's own
 * connection.
 *
 * Failure model: at-most-once, never blocking. If Redis is down the publish
 * fails fast (offline queue off, short command timeout), is counted, and falls
 * back to a local emit so same-process listeners still get it; the inbox
 * endpoint is the source of truth after a reconnect. ioredis reconnects and
 * resubscribes on its own.
 *
 * Without `REDIS_PUBSUB_URL` (tests, a bare dev box) events are emitted
 * locally and nothing connects.
 */
@Injectable()
export class NotificationPubSub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationPubSub.name);
  readonly emitter = new EventEmitter2();
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(private readonly config: ConfigService) {
    const url = config.get<string>("REDIS_PUBSUB_URL");
    if (!url) return;
    const timeout = config.get<number>("REDIS_PUBSUB_TIMEOUT_MS") ?? 250;
    this.publisher = this.client(url, {
      commandTimeout: timeout,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  /** Whether events cross processes (a pub/sub Redis is configured). */
  get distributed(): boolean {
    return Boolean(this.publisher);
  }

  onModuleInit(): void {
    const url = this.config.get<string>("REDIS_PUBSUB_URL");
    if (!url) return;
    if (!runsHttp(parseRole(this.config.get<string>("ROLE")))) return;
    const sub = this.client(url, {});
    this.subscriber = sub;
    sub.on("message", (_channel: string, message: string) =>
      this.onMessage(message),
    );
    sub.on("ready", () => {
      void sub.subscribe(NOTIFICATION_CHANNEL).then(
        () => ssePubsubSubscribers.record(1),
        (err: Error) => this.logger.warn(`subscribe failed: ${err.message}`),
      );
    });
    sub.on("close", () => ssePubsubSubscribers.record(0));
  }

  /** Emit `event` for `row` to every SSE-serving process. Never throws. */
  async publish(event: string, row: Notification): Promise<void> {
    if (!this.publisher) {
      this.emitter.emit(event, row);
      return;
    }
    try {
      await this.publisher.publish(
        NOTIFICATION_CHANNEL,
        JSON.stringify({ event, id: row.id, row }),
      );
      ssePubsubPublished.add(1, { result: "ok" });
    } catch (err) {
      ssePubsubPublished.add(1, { result: "error" });
      this.logger.warn(
        `pub/sub publish failed, emitting locally: ${(err as Error).message}`,
      );
      this.emitter.emit(event, row);
    }
  }

  private onMessage(message: string): void {
    try {
      const { event, row } = JSON.parse(message) as {
        event: string;
        row: Record<string, unknown>;
      };
      this.emitter.emit(event, reviveNotification(row));
      ssePubsubDelivered.add(1);
    } catch (err) {
      this.logger.warn(`bad pub/sub message: ${(err as Error).message}`);
    }
  }

  private client(url: string, extra: RedisOptions) {
    const client = new Redis(url, {
      // Never lazy: a lazy publisher with the offline queue off rejects its
      // first publish and would not connect until then. Without a URL no
      // client is built at all (tests), so nothing connects in suites.
      ...extra,
    });
    // Without a listener an `error` event would crash the process.
    client.on("error", (err) =>
      this.logger.warn(`pub/sub Redis error: ${err.message}`),
    );
    return client;
  }

  onModuleDestroy(): void {
    ssePubsubSubscribers.record(0);
    this.subscriber?.disconnect();
    this.publisher?.disconnect();
  }
}
