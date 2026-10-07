import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker";
import {
  outboundBreakerShortCircuited,
  outboundBreakerState,
} from "../observability/metrics";

/**
 * One shared facility for "is this external API healthy?" — a registry of
 * NAMED circuit breakers on top of the {@link CircuitBreaker} primitive.
 *
 * Callers wrap their existing outbound-request seam in
 * `breakers.run("dlu-lms", fn, { classify })`. The caller owns the failure
 * classification (what counts as "the upstream is in trouble" differs per API);
 * this file owns state, metrics, the transition log line and the error type.
 *
 * Per Nest process, like the primitive. Breakers are created lazily per name.
 * Options come from `OUTBOUND_BREAKER_*` config, falling back to the
 * `INGESTION_BREAKER_*` names the DLU rollout introduced.
 */

/** Injection token for a test clock (ms). Optional; defaults to `Date.now`. */
export const OUTBOUND_CLOCK = Symbol("OUTBOUND_CLOCK");

/** Thrown, with NO request made, while a breaker is open. */
export class UpstreamUnavailableError extends Error {
  constructor(
    readonly upstream: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `${upstream} is temporarily unavailable; retry in ~${Math.ceil(retryAfterMs / 1000)}s`,
    );
    this.name = "UpstreamUnavailableError";
  }
}

/**
 * What a finished call says about upstream health.
 * - `success`: upstream answered sanely (closes a half-open breaker).
 * - `failure`: transport-level trouble (timeout, connect, 5xx, 429).
 * - `neutral`: upstream answered but the problem is ours/the caller's (4xx,
 *   parse errors); neither counts nor closes.
 * A failure may carry `retryAfterMs` (from a `Retry-After` header) to hold the
 * breaker shut at least that long.
 */
export type Verdict =
  | "success"
  | "failure"
  | "neutral"
  | { verdict: "failure"; retryAfterMs?: number };

export type CallResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export interface RunOptions<T> {
  /** Defaults: a thrown error is a failure, a returned value a success. */
  classify?: (result: CallResult<T>) => Verdict;
}

const LOG_MIN_INTERVAL_MS = 10_000;
/** Floor for `retryAfterMs` while a half-open probe is in flight. */
const MIN_RETRY_AFTER_MS = 1_000;
const STATE_CODE = { closed: 0, half_open: 1, open: 2 } as const;

export class NamedBreaker {
  private readonly breaker: CircuitBreaker;
  private holdUntil = 0;
  /** Logical state for transition logging (half-open counts as open). */
  private logical: "closed" | "open" = "closed";
  private lastLogAt = -Infinity;

  constructor(
    readonly name: string,
    private readonly opts: CircuitBreakerOptions,
    private readonly now: () => number,
    private readonly logger: Logger,
  ) {
    this.breaker = new CircuitBreaker(now, opts);
  }

  get state() {
    return this.breaker.state;
  }

  /**
   * `null` when a call may go out (or may probe); otherwise ms until it might.
   * Never consumes the half-open probe slot, so it is safe for "should I even
   * claim work?" checks.
   */
  unavailableFor(): number | null {
    const hold = this.holdUntil - this.now();
    const s = this.breaker.state;
    if (s === "open") {
      return Math.max(this.breaker.remainingOpenMs, hold, MIN_RETRY_AFTER_MS);
    }
    return hold > 0 ? hold : null;
  }

  async run<T>(fn: () => Promise<T>, options: RunOptions<T> = {}): Promise<T> {
    const hold = this.holdUntil - this.now();
    if (hold > 0 || !this.breaker.tryAcquire()) {
      outboundBreakerShortCircuited.add(1, { upstream: this.name });
      this.publish();
      throw new UpstreamUnavailableError(
        this.name,
        Math.max(hold, this.breaker.remainingOpenMs, MIN_RETRY_AFTER_MS),
      );
    }

    let result: CallResult<T>;
    try {
      result = { ok: true, value: await fn() };
    } catch (error) {
      result = { ok: false, error };
    }
    let verdict: Verdict;
    try {
      verdict = options.classify
        ? options.classify(result)
        : result.ok
          ? "success"
          : "failure";
    } catch {
      verdict = "neutral";
    }
    this.report(verdict);
    if (!result.ok) throw result.error;
    return result.value;
  }

  private report(verdict: Verdict): void {
    const kind = typeof verdict === "string" ? verdict : verdict.verdict;
    if (kind === "success") this.breaker.onSuccess();
    else if (kind === "neutral") this.breaker.onNeutral();
    else {
      this.breaker.onFailure();
      if (typeof verdict !== "string" && verdict.retryAfterMs) {
        const capped = Math.min(verdict.retryAfterMs, this.opts.maxOpenMs);
        this.holdUntil = Math.max(this.holdUntil, this.now() + capped);
      }
    }
    this.publish();
    this.logTransition();
  }

  private publish(): void {
    outboundBreakerState.record(STATE_CODE[this.breaker.state], {
      upstream: this.name,
    });
  }

  private logTransition(): void {
    const s = this.breaker.state;
    let line: string | null = null;
    if (s === "open" && this.logical === "closed") {
      this.logical = "open";
      line = `Circuit OPEN for ${this.name}: calls short-circuit for ~${Math.round(this.breaker.remainingOpenMs / 1000)}s`;
    } else if (s === "closed" && this.logical === "open") {
      this.logical = "closed";
      line = `Circuit CLOSED for ${this.name}: upstream recovered`;
    }
    if (!line) return;
    const t = this.now();
    if (t - this.lastLogAt < LOG_MIN_INTERVAL_MS) return;
    this.lastLogAt = t;
    this.logger.warn(line);
  }
}

@Injectable()
export class OutboundBreakers {
  private readonly logger = new Logger("OutboundBreaker");
  private readonly breakers = new Map<string, NamedBreaker>();
  private readonly opts: CircuitBreakerOptions;
  private readonly now: () => number;

  constructor(
    config: ConfigService,
    @Optional() @Inject(OUTBOUND_CLOCK) clock?: () => number,
  ) {
    this.now = clock ?? Date.now;
    const num = (name: string, fallback: number) => {
      const v = Number(config.get<number | string>(name));
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    this.opts = {
      consecutiveFailures: num("INGESTION_BREAKER_FAILURES", 5),
      openMs: num("INGESTION_BREAKER_OPEN_MS", 60_000),
      maxOpenMs: num("INGESTION_BREAKER_MAX_OPEN_MS", 600_000),
    };
  }

  get(name: string): NamedBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new NamedBreaker(name, this.opts, this.now, this.logger);
      this.breakers.set(name, b);
    }
    return b;
  }

  run<T>(
    name: string,
    fn: () => Promise<T>,
    options?: RunOptions<T>,
  ): Promise<T> {
    return this.get(name).run(fn, options);
  }

  /** ms until `name` may be called, or `null` if it can be. Non-consuming. */
  unavailableFor(name: string): number | null {
    return this.get(name).unavailableFor();
  }
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms, or `undefined`. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Standard HTTP classification for {@link RunOptions.classify}: a rejected
 * fetch (timeout / connect error) and 5xx/429 count against the upstream (a
 * 429/503 `Retry-After` holds the breaker shut); any other 4xx is the caller's
 * problem (neutral); everything else is success. Parse errors happen after the
 * response is classified, so they never count.
 */
export function classifyHttpResult(
  result: CallResult<Response>,
  now: () => number = Date.now,
): Verdict {
  if (!result.ok) return "failure";
  const status = result.value.status;
  if (status === 429 || status === 503) {
    return {
      verdict: "failure",
      retryAfterMs: parseRetryAfterMs(
        result.value.headers?.get?.("retry-after"),
        now(),
      ),
    };
  }
  if (status >= 500) return "failure";
  if (status >= 400) return "neutral";
  return "success";
}
