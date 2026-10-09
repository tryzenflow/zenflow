import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_REDIS } from "../queue/queue.constants";
import {
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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RATE_LIMIT_REDIS_CLIENT) private readonly rateLimitRedis: Redis,
    private readonly config: ConfigService,
    @Optional() @Inject(QUEUE_REDIS) private readonly queueRedis?: Redis | null,
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
    return this.run({
      postgres: () => this.prisma.$queryRaw`SELECT 1`,
      redis: () => this.redis.ping(),
      redisRateLimit: () => this.rateLimitRedis.ping(),
      // Absent in the test fallback (jobs are recorded in memory).
      ...(this.queueRedis ? { redisQueue: () => this.queueRedis!.ping() } : {}),
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
    return { status: ok ? "ok" : "error", checks };
  }
}
