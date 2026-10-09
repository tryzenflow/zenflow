import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { killSwitchFlag } from "../../observability/metrics";
import { KILLSWITCH_REDIS_CLIENT } from "../redis/redis.constants";
import {
  KILLSWITCH_AUDIT_MAXLEN,
  KILLSWITCH_AUDIT_STREAM,
  KILLSWITCH_FLAGS,
  KILLSWITCH_FLAG_NAMES,
  KILLSWITCH_KEY_PREFIX,
  type KillSwitchAuditEntry,
  type KillSwitchFlag,
} from "./killswitch.flags";

const DEFAULT_CACHE_TTL_MS = 5000;

/**
 * Atomic write: flag + audit record in one round trip, so the audit trail can
 * never drift from the flag state. KEYS[1]=flag key, KEYS[2]=audit stream,
 * ARGV=[value, maxlen, flag, actor, reason].
 */
const SET_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
return redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[2], '*',
  'flag', ARGV[3], 'value', ARGV[1], 'actor', ARGV[4], 'reason', ARGV[5])
`;

/** Reads every flag in one round trip. KEYS = flag keys; returns raw values. */
const READ_ALL_SCRIPT = `
local out = {}
for i, key in ipairs(KEYS) do out[i] = redis.call('GET', key) end
return out
`;

type KillSwitchRedis = Redis & {
  ksSet(
    flagKey: string,
    auditKey: string,
    value: string,
    maxlen: number,
    flag: string,
    actor: string,
    reason: string,
  ): Promise<string>;
  ksReadAll(...keys: string[]): Promise<Array<string | null>>;
};

/**
 * Reads and writes runtime flags on the dedicated kill-switch Redis. Reads
 * are served from a short-TTL in-process snapshot refreshed for all flags in
 * a single Lua call, and never throw: an unset URL, an outage or a timeout
 * resolves to each flag's documented fail-safe default.
 */
@Injectable()
export class KillSwitchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KillSwitchService.name);
  private readonly redis: KillSwitchRedis | null;
  private readonly ttlMs: number;
  private snapshot: {
    at: number;
    values: Map<KillSwitchFlag, boolean>;
  } | null = null;
  private inflight: Promise<Map<KillSwitchFlag, boolean>> | null = null;

  constructor(
    @Inject(KILLSWITCH_REDIS_CLIENT) redis: Redis | null,
    config: ConfigService,
  ) {
    this.ttlMs =
      config.get<number>("KILLSWITCH_CACHE_TTL_MS") ?? DEFAULT_CACHE_TTL_MS;
    if (redis) {
      redis.defineCommand("ksSet", { numberOfKeys: 2, lua: SET_SCRIPT });
      redis.defineCommand("ksReadAll", {
        lua: READ_ALL_SCRIPT,
      });
    }
    this.redis = redis as KillSwitchRedis | null;
  }

  /** Publishes each flag's current state as a gauge, read from the cache. */
  onModuleInit(): void {
    killSwitchFlag.addCallback(async (result) => {
      const flags = await this.all();
      for (const f of KILLSWITCH_FLAG_NAMES) {
        result.observe(flags[f] ? 1 : 0, { flag: f });
      }
    });
  }

  async isEnabled(flag: KillSwitchFlag): Promise<boolean> {
    const values = await this.load();
    return values.get(flag) ?? KILLSWITCH_FLAGS[flag].normal;
  }

  /** All flags (cached), for the CLI and the metrics gauge. */
  async all(): Promise<Record<KillSwitchFlag, boolean>> {
    const values = await this.load();
    return Object.fromEntries(
      KILLSWITCH_FLAG_NAMES.map((f) => [
        f,
        values.get(f) ?? KILLSWITCH_FLAGS[f].normal,
      ]),
    ) as Record<KillSwitchFlag, boolean>;
  }

  /**
   * Sets a flag and appends the audit record atomically. Throws if Redis is
   * unreachable — an operator must know the change did not apply.
   */
  async set(
    flag: KillSwitchFlag,
    value: boolean,
    actor: string,
    reason: string,
  ): Promise<void> {
    if (!this.redis) {
      throw new Error("REDIS_KILLSWITCH_URL is not configured");
    }
    await this.whenReady(this.redis);
    await this.redis.ksSet(
      KILLSWITCH_KEY_PREFIX + flag,
      KILLSWITCH_AUDIT_STREAM,
      value ? "1" : "0",
      KILLSWITCH_AUDIT_MAXLEN,
      flag,
      actor,
      reason,
    );
    this.snapshot = null;
  }

  async history(limit = 20): Promise<KillSwitchAuditEntry[]> {
    if (!this.redis) return [];
    await this.whenReady(this.redis);
    const rows = await this.redis.xrevrange(
      KILLSWITCH_AUDIT_STREAM,
      "+",
      "-",
      "COUNT",
      limit,
    );
    return rows.map(([id, fields]) => {
      const f: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) f[fields[i]] = fields[i + 1];
      return {
        id,
        flag: f.flag as KillSwitchFlag,
        value: f.value === "1",
        actor: f.actor,
        reason: f.reason,
        at: new Date(Number(id.split("-")[0])).toISOString(),
      };
    });
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  /**
   * The client is fast-fail (no offline queue), so a command issued right
   * after construction would be rejected before the socket is up. Operator
   * paths (`set`, `history`) wait for the connection; request-path reads do not.
   */
  async waitUntilReady(): Promise<void> {
    if (this.redis) await this.whenReady(this.redis);
  }

  private whenReady(redis: Redis, timeoutMs = 2000): Promise<void> {
    if (redis.status === "ready") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        redis.off("ready", onReady);
        reject(new Error("kill-switch Redis is not reachable"));
      }, timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      redis.once("ready", onReady);
    });
  }

  private load(): Promise<Map<KillSwitchFlag, boolean>> {
    const snap = this.snapshot;
    if (snap && Date.now() - snap.at < this.ttlMs) {
      return Promise.resolve(snap.values);
    }
    // Coalesce concurrent refreshes into one Redis call.
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<Map<KillSwitchFlag, boolean>> {
    const values = new Map<KillSwitchFlag, boolean>();
    if (this.redis) {
      try {
        const raw = await this.redis.ksReadAll(
          String(KILLSWITCH_FLAG_NAMES.length),
          ...KILLSWITCH_FLAG_NAMES.map((f) => KILLSWITCH_KEY_PREFIX + f),
        );
        KILLSWITCH_FLAG_NAMES.forEach((f, i) => {
          if (raw[i] !== null && raw[i] !== undefined) {
            values.set(f, raw[i] === "1");
          }
        });
      } catch (err) {
        this.logger.warn(
          `kill-switch Redis unreachable, using fail-safe defaults: ${err}`,
        );
        for (const f of KILLSWITCH_FLAG_NAMES) {
          values.set(f, KILLSWITCH_FLAGS[f].failSafe);
        }
      }
    }
    // Cache the failure too, so an outage costs one timeout per TTL, not one
    // per call.
    this.snapshot = { at: Date.now(), values };
    return values;
  }
}
