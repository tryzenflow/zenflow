import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PLACEMENT_CONTRACT_VERSION,
  type PlaceRequest,
  type PlaceResponse,
} from "@zenflow/shared";
import {
  banditClientDuration,
  schedulerBreakerState,
} from "../../observability/metrics";

import { CircuitBreaker } from "./circuit-breaker";
import type { DegradedReason } from "./placement-mode";

/** Total per-call budget (ADR-0003 section 3.4). Override with `PLACE_TIMEOUT_MS`. */
export const PLACE_TIMEOUT_MS = 2_500;
/** A retry is only attempted when the failed attempt came back within this. */
export const PLACE_RETRY_WINDOW_MS = 300;
const RETRY_JITTER_MS = 50;

export type PlaceResult =
  | { ok: true; response: PlaceResponse }
  | { ok: false; reason: DegradedReason };

/** Injectable I/O seams so unit tests need no network and no real clock. */
export interface PlacementClientDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const PLACEMENT_CLIENT_DEPS = Symbol("PLACEMENT_CLIENT_DEPS");

/**
 * HTTP client for the Python `POST /v1/place` (ADR-0003 section 3.4). Never
 * throws: every failure is folded into `{ ok: false, reason }` so the caller
 * can hand the request to the frozen TS fallback.
 *
 * - Timeout `PLACE_TIMEOUT_MS` total (fetch cannot enforce a separate 300 ms
 *   connect timeout without a custom dispatcher; connect-refused fails fast
 *   anyway).
 * - `/place` is idempotent: retried once (50 ms jitter) ONLY on connect
 *   refused/reset or 502-504 that returned within 300 ms. Never a timeout,
 *   never a 4xx.
 * - Circuit breaker: transient failures (timeout, connect, 5xx) count; 4xx and
 *   contract errors fall back but do not trip it (the service is healthy).
 * - Unset `BANDIT_SERVICE_URL` => `disabled` (not an incident).
 */
@Injectable()
export class PlacementClient {
  private readonly logger = new Logger(PlacementClient.name);
  private readonly baseUrl?: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly deps: PlacementClientDeps;
  readonly breaker: CircuitBreaker;

  constructor(
    config: ConfigService,
    @Optional()
    @Inject(PLACEMENT_CLIENT_DEPS)
    deps?: Partial<PlacementClientDeps>,
  ) {
    this.baseUrl = config
      .get<string>("BANDIT_SERVICE_URL")
      ?.replace(/\/+$/, "");
    this.token = config.get<string>("BANDIT_SERVICE_TOKEN") || undefined;
    this.timeoutMs = Number(config.get("PLACE_TIMEOUT_MS")) || PLACE_TIMEOUT_MS;
    this.deps = {
      fetch: deps?.fetch ?? ((input, init) => fetch(input, init)),
      now: deps?.now ?? (() => Date.now()),
      sleep:
        deps?.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      random: deps?.random ?? Math.random,
    };
    this.breaker = new CircuitBreaker(this.deps.now);
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl);
  }

  async place(req: PlaceRequest): Promise<PlaceResult> {
    if (!this.baseUrl) return { ok: false, reason: "disabled" };
    if (!this.breaker.tryAcquire()) {
      this.publishBreaker();
      return { ok: false, reason: "breaker_open" };
    }

    let outcome = await this.attempt(req);
    if (!outcome.ok && outcome.retryable) {
      await this.deps.sleep(Math.round(this.deps.random() * RETRY_JITTER_MS));
      outcome = await this.attempt(req);
    }

    if (outcome.ok) {
      this.breaker.onSuccess();
    } else if (outcome.transient) {
      this.breaker.onFailure();
    } else {
      this.breaker.onNeutral();
    }
    this.publishBreaker();
    return outcome.ok
      ? { ok: true, response: outcome.response }
      : { ok: false, reason: outcome.reason };
  }

  private publishBreaker(): void {
    const s = this.breaker.state;
    schedulerBreakerState.record(
      s === "closed" ? 0 : s === "half_open" ? 1 : 2,
    );
  }

  private async attempt(req: PlaceRequest): Promise<
    | { ok: true; response: PlaceResponse }
    | {
        ok: false;
        reason: DegradedReason;
        transient: boolean;
        retryable: boolean;
      }
  > {
    const start = this.deps.now();
    const record = (status: string) =>
      banditClientDuration.record((this.deps.now() - start) / 1000, {
        operation: "place",
        status,
      });
    const fastFail = () => this.deps.now() - start <= PLACE_RETRY_WINDOW_MS;

    let res: Response;
    try {
      res = await this.deps.fetch(`${this.baseUrl}/v1/place`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        record("timeout");
        this.logger.warn(`place ${req.requestId} timed out`);
        return {
          ok: false,
          reason: "timeout",
          transient: true,
          retryable: false,
        };
      }
      record("error");
      this.logger.warn(
        `place ${req.requestId} unreachable: ${(err as Error).message}`,
      );
      return {
        ok: false,
        reason: "connect",
        transient: true,
        retryable: fastFail(),
      };
    }

    record(String(res.status));
    if (res.ok) return this.parseOk(req, res);

    if (res.status >= 500) {
      this.logger.warn(`place ${req.requestId} -> ${res.status}`);
      return {
        ok: false,
        reason: "http_5xx",
        transient: true,
        retryable: res.status >= 502 && res.status <= 504 && fastFail(),
      };
    }

    const body = (await res.json().catch(() => null)) as {
      code?: string;
    } | null;
    const reason: DegradedReason =
      res.status === 422 && body?.code === "CONTRACT_VERSION"
        ? "version"
        : "http_4xx";
    // 4xx = a Nest bug, a bad token or version drift: page-worthy, not transient.
    this.logger.error(`place ${req.requestId} -> ${res.status} (${reason})`);
    return { ok: false, reason, transient: false, retryable: false };
  }

  private async parseOk(req: PlaceRequest, res: Response) {
    const body = (await res.json().catch(() => null)) as PlaceResponse | null;
    const valid =
      body !== null &&
      body.contractVersion === PLACEMENT_CONTRACT_VERSION &&
      Array.isArray(body.results) &&
      body.results.length === req.members.length;
    if (!valid) {
      this.logger.error(`place ${req.requestId}: invalid response body`);
      return {
        ok: false as const,
        reason: "invalid_response" as const,
        transient: false,
        retryable: false,
      };
    }
    return { ok: true as const, response: body };
  }
}
