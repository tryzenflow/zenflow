import { Injectable, Logger } from "@nestjs/common";
import {
  type PushDataPayload,
  pushCategoryFor,
  pushToneFor,
} from "@zenflow/shared";
import { type Notification } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { ApnsSender } from "./apns.sender";
import { FcmSender } from "./fcm.sender";
import type { PushMessage, SendResult } from "./types";
import { pushDevicesPruned, pushSend } from "../observability/metrics";
import { withSpan } from "../observability/otel";
import { localizeNotification } from "../notifications/localize-notification";
import type { PushProvider } from "../queue/queues";

/**
 * Wraps one provider call, e.g. with that provider's circuit breaker
 * (`fcm` / `apns`). The default runs it as is.
 */
export type ProviderGuard = <T>(
  provider: PushProvider,
  fn: () => Promise<T>,
) => Promise<T>;

const unguarded: ProviderGuard = (_provider, fn) => fn();

export interface SendOptions {
  /** Only this provider (a per-provider job); omitted = both. */
  provider?: PushProvider;
  /**
   * With a guard that can park the job (breaker), `provider` must be set:
   * parking a both-provider job would re-send to the provider that succeeded.
   */
  guard?: ProviderGuard;
}

/** Options of a queue job: always one provider. */
export type DeliverOptions = SendOptions & { provider: PushProvider };

/** Every token of a provider failed transiently: worth a retry, and a breaker failure. */
export class PushProviderError extends Error {
  constructor(
    readonly provider: PushProvider,
    attempted: number,
  ) {
    super(`${provider}: all ${attempted} send(s) failed`);
    this.name = "PushProviderError";
  }
}

/**
 * Delivers one {@link Notification} to the user's registered devices. It is the
 * body of the `notify` queue's `push` job (`NotifyProcessor`); nothing
 * subscribes to the in-process emitter any more, so delivery is retried,
 * rate-limited and deduplicated by BullMQ rather than fired inline.
 *
 * A provider that answers nothing useful for every token throws
 * {@link PushProviderError} so the job retries with backoff and the
 * `fcm`/`apns` breaker counts it; a partial success is a success. Tokens the
 * providers report dead are pruned.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmSender,
    private readonly apns: ApnsSender,
  ) {}

  /**
   * Load the notification and push it. Throws when the row is missing (the
   * producer may have enqueued before its transaction committed; the retry
   * finds it).
   */
  async deliver(notificationId: string, opts: DeliverOptions): Promise<void> {
    // A queue worker has no ambient async context: open a fresh root span.
    await withSpan("push.deliver", async () => {
      const row = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
      if (!row) throw new Error(`notification ${notificationId} not found`);
      await this.sendToUser(row.userId, row, opts);
    });
  }

  /**
   * Deliver one notification to every device `userId` has registered. A no-op
   * when neither provider is configured or the user has no devices.
   */
  async sendToUser(
    userId: string,
    row: Notification,
    opts: SendOptions = {},
  ): Promise<void> {
    const guard = opts.guard ?? unguarded;
    const wantFcm = !opts.provider || opts.provider === "fcm";
    const wantApns = !opts.provider || opts.provider === "apns";
    if ((!wantFcm || !this.fcm.enabled) && (!wantApns || !this.apns.enabled)) {
      this.logger.warn(
        `sendToUser(${userId}): sender disabled — set FCM_SERVICE_ACCOUNT and/or the APNS_* vars`,
      );
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { allowNotifications: true, lang: true },
    });
    if (user && !user.allowNotifications) return;
    row = localizeNotification(row, user?.lang);

    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { platform: true, pushToken: true },
    });
    if (devices.length === 0) {
      this.logger.warn(
        `sendToUser(${userId}): user has no registered devices (POST /devices first)`,
      );
      return;
    }

    const android = wantFcm
      ? devices.filter((d) => d.platform === "ANDROID").map((d) => d.pushToken)
      : [];
    const ios = wantApns
      ? devices.filter((d) => d.platform === "IOS").map((d) => d.pushToken)
      : [];
    this.logger.log(
      `sendToUser(${userId}): ${android.length} android + ${ios.length} ios device(s)` +
        `${!this.fcm.enabled && android.length ? " [FCM disabled]" : ""}` +
        `${!this.apns.enabled && ios.length ? " [APNs disabled]" : ""}`,
    );

    const msg: PushMessage = {
      title: row.title,
      body: row.content,
      data: this.dataFor(row),
      tone: pushToneFor(row.eventName),
      category: pushCategoryFor(row.eventName),
    };

    const settled = await Promise.allSettled([
      this.sendVia("fcm", this.fcm, android, msg, guard),
      this.sendVia("apns", this.apns, ios, msg, guard),
    ]);
    const stale = settled.flatMap((r) =>
      r.status === "fulfilled" ? r.value.invalidTokens : [],
    );
    if (stale.length > 0) {
      const { count } = await this.prisma.userDevice.deleteMany({
        where: { pushToken: { in: stale } },
      });
      this.logger.log(`pruned ${count} dead device token(s)`);
      pushDevicesPruned.add(count);
    }
    // Both providers have been tried (and dead tokens pruned) before a failure
    // surfaces, so a retry never re-sends to the one that succeeded unless the
    // job was provider-less.
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }

  private async sendVia(
    provider: PushProvider,
    sender: {
      enabled: boolean;
      send(t: string[], m: PushMessage): Promise<SendResult>;
    },
    tokens: string[],
    msg: PushMessage,
    guard: ProviderGuard,
  ): Promise<SendResult> {
    if (tokens.length === 0 || !sender.enabled) {
      return { sent: 0, invalidTokens: [] };
    }
    const res = await guard(provider, async () => {
      const r = await sender.send(tokens, msg);
      recordPushResult(provider, tokens.length, r);
      this.logger.log(
        `${provider}: ${r.sent}/${tokens.length} ok, ${r.invalidTokens.length} dead`,
      );
      if (r.sent === 0 && r.invalidTokens.length === 0) {
        throw new PushProviderError(provider, tokens.length);
      }
      return r;
    });
    return res;
  }

  private dataFor(row: Notification): PushDataPayload {
    return {
      notificationId: row.id,
      eventName: row.eventName,
      sessionId: row.sessionId ?? "",
      url: row.sessionId
        ? `/calendar?session=${row.sessionId}`
        : "/notifications",
    };
  }
}

/** Split one provider's send result into sent / failed / invalid_token counts. */
function recordPushResult(
  provider: "fcm" | "apns",
  attempted: number,
  res: { sent: number; invalidTokens: string[] },
): void {
  if (attempted === 0) return;
  const invalid = res.invalidTokens.length;
  const failed = Math.max(0, attempted - res.sent - invalid);
  if (res.sent > 0) pushSend.add(res.sent, { provider, result: "sent" });
  if (failed > 0) pushSend.add(failed, { provider, result: "failed" });
  if (invalid > 0) pushSend.add(invalid, { provider, result: "invalid_token" });
}
