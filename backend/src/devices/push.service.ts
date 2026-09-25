import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { PushDataPayload } from "@zenflow/shared";
import { type Notification } from "../../generated/prisma";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationEvent } from "../notifications/types";
import { PrismaService } from "../prisma/prisma.service";
import { ApnsSender } from "./apns.sender";
import { FcmSender } from "./fcm.sender";
import type { PushMessage } from "./types";
import { pushDevicesPruned, pushSend } from "../observability/metrics";
import { withSpan } from "../observability/otel";

/**
 * Fans every raised {@link Notification} out to the user's registered devices.
 *
 * A second subscriber to `NotificationsService.notificationEmitter`, alongside
 * the SSE stream in `NotificationsController` — ingestion never learns about
 * delivery channels. Best-effort throughout: a failed send is swallowed, and
 * tokens the providers report as dead are pruned.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly fcm: FcmSender,
    private readonly apns: ApnsSender,
  ) {}

  onModuleInit(): void {
    this.notifications.notificationEmitter.on(
      NotificationEvent.NEW_SESSION,
      (row: Notification) => void this.handleNewSession(row),
    );
  }

  private async handleNewSession(row: Notification): Promise<void> {
    // Fired from the notification EventEmitter via `void ...`, so there is no
    // ambient async context — open a fresh root span (a full parent/child link
    // back to the materializer trace would need context capture at `notify()`).
    await withSpan("push.handleNewSession", async () => {
      try {
        await this.sendToUser(row.userId, row);
      } catch (err) {
        this.logger.warn(
          `push for notification ${row.id} failed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Deliver one notification to every device `userId` has registered. A no-op
   * when neither provider is configured or the user has no devices.
   */
  async sendToUser(userId: string, row: Notification): Promise<void> {
    if (!this.fcm.enabled && !this.apns.enabled) {
      this.logger.warn(
        `sendToUser(${userId}): both senders disabled — set FCM_SERVICE_ACCOUNT and/or the APNS_* vars`,
      );
      return;
    }

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

    const android = devices
      .filter((d) => d.platform === "ANDROID")
      .map((d) => d.pushToken);
    const ios = devices
      .filter((d) => d.platform === "IOS")
      .map((d) => d.pushToken);
    this.logger.log(
      `sendToUser(${userId}): ${android.length} android + ${ios.length} ios device(s)` +
        `${!this.fcm.enabled && android.length ? " [FCM disabled]" : ""}` +
        `${!this.apns.enabled && ios.length ? " [APNs disabled]" : ""}`,
    );

    const msg: PushMessage = {
      title: row.title,
      body: row.content,
      data: this.dataFor(row),
    };

    const [fcmRes, apnsRes] = await Promise.all([
      this.fcm.send(android, msg),
      this.apns.send(ios, msg),
    ]);
    this.logger.log(
      `sendToUser(${userId}): fcm ${fcmRes.sent}/${android.length} ok, apns ${apnsRes.sent}/${ios.length} ok`,
    );
    recordPushResult("fcm", android.length, fcmRes);
    recordPushResult("apns", ios.length, apnsRes);

    const stale = [...fcmRes.invalidTokens, ...apnsRes.invalidTokens];
    if (stale.length > 0) {
      const { count } = await this.prisma.userDevice.deleteMany({
        where: { pushToken: { in: stale } },
      });
      this.logger.log(`pruned ${count} dead device token(s)`);
      pushDevicesPruned.add(count);
    }
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
