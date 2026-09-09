import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Notification, Provider } from "@parse/node-apn";
import { toStringMap, type PushMessage, type SendResult } from "./types";

/** APNs `reason` values (and the 410 status) that mean the token is dead. */
const APNS_DEAD_TOKEN_REASONS = new Set<string>([
  "Unregistered",
  "BadDeviceToken",
  "ExpiredToken",
]);

/**
 * iOS delivery via Apple APNs over HTTP/2, token (`.p8`) auth.
 *
 * Self-disabling: unless all of `APNS_KEY` / `APNS_KEY_ID` / `APNS_TEAM_ID` /
 * `APNS_BUNDLE_ID` resolve, the sender is inert and {@link enabled} is false.
 * Best-effort — never throws; only reports which tokens to prune.
 */
@Injectable()
export class ApnsSender implements OnModuleDestroy {
  private readonly logger = new Logger(ApnsSender.name);
  private readonly provider?: Provider;
  private readonly topic?: string;

  constructor(configService: ConfigService) {
    const key = configService.get<string>("APNS_KEY");
    const keyId = configService.get<string>("APNS_KEY_ID");
    const teamId = configService.get<string>("APNS_TEAM_ID");
    const bundleId = configService.get<string>("APNS_BUNDLE_ID");
    if (!key || !keyId || !teamId || !bundleId) {
      this.logger.log("APNs disabled (APNS_* not fully configured)");
      return;
    }
    try {
      this.provider = new Provider({
        token: {
          key: Buffer.from(key, "base64").toString("utf8"),
          keyId,
          teamId,
        },
        production: configService.get<boolean>("APNS_PRODUCTION") ?? false,
      });
      this.topic = bundleId;
      this.logger.log("APNs enabled");
    } catch (err) {
      this.logger.error(`APNs disabled: ${(err as Error).message}`);
    }
  }

  get enabled(): boolean {
    return Boolean(this.provider);
  }

  async send(tokens: string[], msg: PushMessage): Promise<SendResult> {
    if (!this.provider || !this.topic || tokens.length === 0) {
      return { sent: 0, invalidTokens: [] };
    }

    const note = new Notification();
    note.topic = this.topic;
    note.priority = 10;
    note.pushType = "alert";
    note.sound = "default";
    note.alert = { title: msg.title, body: msg.body };
    note.payload = toStringMap(msg.data);

    try {
      const result = await this.provider.send(note, tokens);
      const invalidTokens = result.failed
        .filter(
          (f) =>
            Number(f.status) === 410 ||
            (f.response?.reason != null &&
              APNS_DEAD_TOKEN_REASONS.has(f.response.reason)),
        )
        .map((f) => f.device);
      const transient = result.failed.length - invalidTokens.length;
      if (transient > 0) {
        const reasons = result.failed
          .map((f) => f.response?.reason ?? f.status ?? "?")
          .join(", ");
        this.logger.warn(`APNs: ${transient} send(s) failed (${reasons})`);
      }
      return { sent: result.sent.length, invalidTokens };
    } catch (err) {
      this.logger.warn(`APNs send threw (${(err as Error).message})`);
      return { sent: 0, invalidTokens: [] };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.provider?.shutdown();
  }
}
