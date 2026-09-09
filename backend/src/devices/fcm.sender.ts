import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { toStringMap, type PushMessage, type SendResult } from "./types";

/** FCM caps a multicast at 500 tokens per call. */
const FCM_MULTICAST_LIMIT = 500;

/** FCM error codes that mean "this token is dead — stop using it". */
const FCM_DEAD_TOKEN_CODES = new Set<string>([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Android delivery via Firebase Cloud Messaging.
 *
 * Self-disabling like {@link BanditService}: with no `FCM_SERVICE_ACCOUNT` the
 * sender is inert and {@link enabled} is false. Every send is best-effort and
 * never throws; the return value only reports which tokens to prune.
 */
@Injectable()
export class FcmSender implements OnModuleDestroy {
  private readonly logger = new Logger(FcmSender.name);
  private readonly app?: App;
  private readonly messaging?: Messaging;

  constructor(configService: ConfigService) {
    const raw = configService.get<string>("FCM_SERVICE_ACCOUNT");
    if (!raw) {
      this.logger.log("FCM disabled (no FCM_SERVICE_ACCOUNT)");
      return;
    }
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(raw, "base64").toString("utf8"),
      ) as Parameters<typeof cert>[0];
      this.app = initializeApp(
        { credential: cert(serviceAccount) },
        "zenflow-fcm",
      );
      this.messaging = getMessaging(this.app);
      this.logger.log("FCM enabled");
    } catch (err) {
      this.logger.error(
        `FCM disabled: bad FCM_SERVICE_ACCOUNT (${(err as Error).message})`,
      );
    }
  }

  get enabled(): boolean {
    return Boolean(this.messaging);
  }

  async send(tokens: string[], msg: PushMessage): Promise<SendResult> {
    if (!this.messaging || tokens.length === 0) {
      return { sent: 0, invalidTokens: [] };
    }

    const data = toStringMap(msg.data);
    const invalidTokens: string[] = [];
    let sent = 0;

    for (let i = 0; i < tokens.length; i += FCM_MULTICAST_LIMIT) {
      const batch = tokens.slice(i, i + FCM_MULTICAST_LIMIT);
      try {
        const res = await this.messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title: msg.title, body: msg.body },
          data,
          android: { priority: "high" },
        });
        res.responses.forEach((r, j) => {
          if (r.success) {
            sent++;
            return;
          }
          const code = r.error?.code ?? "unknown";
          if (FCM_DEAD_TOKEN_CODES.has(code)) invalidTokens.push(batch[j]);
          else this.logger.warn(`FCM send failed (${code})`);
        });
      } catch (err) {
        this.logger.warn(`FCM multicast threw (${(err as Error).message})`);
      }
    }
    return { sent, invalidTokens };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) await deleteApp(this.app);
  }
}
