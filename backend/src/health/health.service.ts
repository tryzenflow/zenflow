import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import IORedis, { type Redis } from "ioredis";
import { createTransport } from "nodemailer";
import { mailTransport, redisOptions } from "../common/config/connections";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_REDIS } from "../queue/queue.constants";
import {
  KILLSWITCH_REDIS_CLIENT,
  RATE_LIMIT_REDIS_CLIENT,
  REDIS_CLIENT,
} from "../common/redis/redis.constants";

const CHECK_TIMEOUT_MS = 2_000;

export interface DependencyStatus {
  status: "up" | "down";
  error?: string;
}

export interface HealthReport {
  status: "ok" | "error";
  checks: Record<string, DependencyStatus>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RATE_LIMIT_REDIS_CLIENT) private readonly rateLimitRedis: Redis,
    private readonly config: ConfigService,
    @Optional() @Inject(QUEUE_REDIS) private readonly queueRedis?: Redis | null,
    @Optional()
    @Inject(KILLSWITCH_REDIS_CLIENT)
    private readonly killswitchRedis?: Redis | null,
  ) {}

  /** Postgres + the session/OTP Redis: what a request needs to be served. */
  ready(): Promise<HealthReport> {
    return this.run({
      postgres: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
    });
  }

  /** Everything `ready` checks plus the optional dependencies. */
  all(): Promise<HealthReport> {
    const banditUrl = this.config.get<string>("BANDIT_SERVICE_URL");
    const pubsub = this.pubsubProbe();
    return this.run({
      postgres: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
      redisRateLimit: () => this.rateLimitRedis.ping(),
      // Absent in the test fallback (jobs are recorded in memory).
      ...(this.queueRedis ? { redisQueue: () => this.queueRedis!.ping() } : {}),
      // Absent when no kill-switch Redis is configured (flags stay at defaults).
      ...(this.killswitchRedis
        ? { redisKillswitch: () => this.killswitchRedis!.ping() }
        : {}),
      // Absent without REDIS_PUBSUB_HOST (events stay in-process).
      ...(pubsub ? { redisPubsub: pubsub } : {}),
      // Uploaded files and signed-URL media: the bucket answers.
      ...(this.config.get<string>("S3_ENDPOINT")
        ? { storage: () => this.storageProbe() }
        : {}),
      // Sign-in codes go out by SMTP: the relay accepts a connection and auth.
      ...(this.config.get<string>("MAIL_HOST")
        ? { mail: () => this.mailProbe() }
        : {}),
      // Absent in dev/test (placement degrades to the frozen heuristic).
      ...(banditUrl
        ? {
            bandit: async () => {
              const res = await fetch(new URL("/health", banditUrl), {
                signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
            },
          }
        : {}),
    });
  }

  private pubsubProbe(): (() => Promise<unknown>) | null {
    const connection = redisOptions(
      (key) => this.config.get(key),
      "REDIS_PUBSUB",
    );
    if (!connection) return null;
    // A one-off connection: the live publisher belongs to NotificationPubSub.
    return async () => {
      const client = new IORedis({
        ...connection,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        connectTimeout: CHECK_TIMEOUT_MS,
      });
      client.on("error", () => undefined);
      try {
        await client.connect();
        await client.ping();
      } finally {
        client.disconnect();
      }
    };
  }

  private s3?: S3Client;

  private async storageProbe(): Promise<void> {
    this.s3 ??= new S3Client({
      endpoint: this.config.getOrThrow<string>("S3_ENDPOINT"),
      region: this.config.get<string>("S3_REGION", "us-east-1"),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
        secretAccessKey: this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
      },
      forcePathStyle: true,
      maxAttempts: 1,
    });
    await this.s3.send(
      new HeadBucketCommand({ Bucket: this.config.getOrThrow("S3_BUCKET") }),
      { abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    );
  }

  private async mailProbe(): Promise<void> {
    const transport = createTransport({
      ...mailTransport((key) => this.config.get(key)),
      connectionTimeout: CHECK_TIMEOUT_MS,
      greetingTimeout: CHECK_TIMEOUT_MS,
      socketTimeout: CHECK_TIMEOUT_MS,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  private async run(
    probes: Record<string, () => PromiseLike<unknown>>,
  ): Promise<HealthReport> {
    const entries = await Promise.all(
      Object.entries(probes).map(
        async ([name, probe]): Promise<[string, DependencyStatus]> => {
          let timer: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              probe(),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("timeout")),
                  CHECK_TIMEOUT_MS,
                );
              }),
            ]);
            return [name, { status: "up" }];
          } catch (err) {
            return [name, { status: "down", error: (err as Error).message }];
          } finally {
            clearTimeout(timer);
          }
        },
      ),
    );
    const checks = Object.fromEntries(entries);
    const ok = entries.every(([, c]) => c.status === "up");
    // The 503 body is reduced to a generic message by AllExceptionsFilter, so
    // name the failing dependencies here or nobody can tell which one it was.
    if (!ok) {
      const down = entries
        .filter(([, c]) => c.status === "down")
        .map(([name, c]) => `${name}: ${c.error}`);
      this.logger.warn(`health check failed: ${down.join("; ")}`);
    }
    return { status: ok ? "ok" : "error", checks };
  }
}
