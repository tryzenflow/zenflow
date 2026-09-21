/**
 * Small in-repo circuit breaker for the Python placement service
 * (ADR-0003 section 3.4). Per Nest process; the clock is injected so tests can
 * drive every transition.
 *
 * CLOSED -> OPEN after `consecutiveFailures` failures in a row (O(1) state; no
 * per-call history is kept).
 * OPEN for `openMs` (every call short-circuits), then HALF_OPEN admits exactly
 * one probe: success closes, failure re-opens with the open time doubled up to
 * `maxOpenMs`.
 */
export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  consecutiveFailures: number;
  openMs: number;
  maxOpenMs: number;
}

export const DEFAULT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  consecutiveFailures: 5,
  openMs: 15_000,
  maxOpenMs: 60_000,
};

export class CircuitBreaker {
  private current: BreakerState = "closed";
  private consecutive = 0;
  private openedAt = 0;
  private currentOpenMs: number;
  private probeInFlight = false;

  constructor(
    private readonly now: () => number,
    private readonly opts: CircuitBreakerOptions = DEFAULT_BREAKER_OPTIONS,
  ) {
    this.currentOpenMs = opts.openMs;
  }

  get state(): BreakerState {
    this.maybeHalfOpen();
    return this.current;
  }

  /** `true` when a call may go out. In HALF_OPEN only the first caller (the probe) is admitted. */
  tryAcquire(): boolean {
    this.maybeHalfOpen();
    if (this.current === "closed") return true;
    if (this.current === "half_open" && !this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    if (this.current === "half_open") {
      this.close();
      return;
    }
    this.consecutive = 0;
  }

  onFailure(): void {
    if (this.current === "half_open") {
      this.currentOpenMs = Math.min(
        this.currentOpenMs * 2,
        this.opts.maxOpenMs,
      );
      this.open();
      return;
    }
    this.consecutive += 1;
    if (this.consecutive >= this.opts.consecutiveFailures) {
      this.open();
    }
  }

  /** Release a HALF_OPEN probe slot without a verdict (e.g. a non-transient 4xx). */
  onNeutral(): void {
    if (this.current === "half_open") this.probeInFlight = false;
  }

  private maybeHalfOpen(): void {
    if (
      this.current === "open" &&
      this.now() - this.openedAt >= this.currentOpenMs
    ) {
      this.current = "half_open";
      this.probeInFlight = false;
    }
  }

  private open(): void {
    this.current = "open";
    this.openedAt = this.now();
    this.probeInFlight = false;
  }

  private close(): void {
    this.current = "closed";
    this.consecutive = 0;
    this.probeInFlight = false;
    this.currentOpenMs = this.opts.openMs;
  }
}
