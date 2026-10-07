import { Logger } from "@nestjs/common";
import type {
  Algorithm,
  AlgorithmConfig,
  RateLimitRuleResult,
  Store,
} from "@limitkit/core";
import type { CircuitBreaker } from "../circuit-breaker";

export const DEFAULT_RATE_LIMIT_STORE_TIMEOUT_MS = 250;
const WARN_INTERVAL_MS = 30_000;

export interface ResilientStoreOptions {
  timeoutMs: number;
  now?: () => number;
  /** Called on every fail-open (breaker open, timeout or error). */
  onFailOpen?: (reason: "breaker_open" | "timeout" | "error") => void;
  logger?: Pick<Logger, "warn">;
}

/**
 * Fail-open decorator for a LimitKit `Store`. Rate-limit state is cheap to
 * lose, so a slow or dead store must never stall or fail an API request: the
 * call is raced against `timeoutMs`, feeds a circuit breaker, and any failure
 * (or an open breaker) yields an "allowed" result instead of throwing.
 */
export class ResilientStore implements Store {
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private suppressed = 0;
  private readonly now: () => number;
  private readonly logger: Pick<Logger, "warn">;

  constructor(
    private readonly inner: Store,
    private readonly breaker: CircuitBreaker,
    private readonly opts: ResilientStoreOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.logger = opts.logger ?? new Logger(ResilientStore.name);
  }

  async consume<TConfig extends AlgorithmConfig>(
    key: string,
    algorithm: Algorithm<TConfig>,
    now: number,
    cost?: number,
  ): Promise<RateLimitRuleResult> {
    if (!this.breaker.tryAcquire()) {
      this.opts.onFailOpen?.("breaker_open");
      return allowedResult(now);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(this.opts.timeoutMs)),
          this.opts.timeoutMs,
        );
      });
      const result = await Promise.race([
        this.inner.consume(key, algorithm, now, cost),
        timeout,
      ]);
      this.breaker.onSuccess();
      return result;
    } catch (err) {
      this.breaker.onFailure();
      this.opts.onFailOpen?.(err instanceof TimeoutError ? "timeout" : "error");
      this.warn(err);
      return allowedResult(now);
    } finally {
      clearTimeout(timer);
    }
  }

  private warn(err: unknown): void {
    const t = this.now();
    if (t - this.lastWarnAt < WARN_INTERVAL_MS) {
      this.suppressed += 1;
      return;
    }
    this.logger.warn(
      `Rate-limit store failing open (breaker ${this.breaker.state}, ${this.suppressed} similar suppressed): ${String(err)}`,
    );
    this.lastWarnAt = t;
    this.suppressed = 0;
  }
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`rate-limit store timed out after ${ms}ms`);
  }
}

/**
 * limit/remaining are 1 (not 0) because the guard's header code divides
 * `remaining / limit`.
 */
function allowedResult(now: number): RateLimitRuleResult {
  return { allowed: true, limit: 1, remaining: 1, resetAt: now };
}
