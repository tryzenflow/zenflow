import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  BanditArmStateWire,
  BanditPredictRequest,
  BanditPredictResponse,
  BanditUpdateRequest,
  BanditUpdateResponse,
  SchedulingArm,
} from "@zenflow/shared";
import { BANDIT_ALPHA, BANDIT_RIDGE } from "../scheduler/constants";

/** Hard ceiling on a single call to the bandit service. */
const REQUEST_TIMEOUT_MS = 2_000;

/**
 * HTTP client for the stateless Python bandit service
 * (`services/bandit/`, `BANDIT_SERVICE_URL`, dev `http://localhost:8100`).
 *
 * Every method is best-effort: on a missing `BANDIT_SERVICE_URL` (feature flag
 * off), a timeout, a network error, or a non-200 it logs a warning and returns
 * `null` so the caller falls back to the heuristic. The service holds no state —
 * `(A, b)` travels in every payload and the caller persists what comes back.
 */
@Injectable()
export class BanditService {
  private readonly logger = new Logger(BanditService.name);
  private readonly baseUrl?: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .get<string>("BANDIT_SERVICE_URL")
      ?.replace(/\/+$/, "");
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl);
  }

  /**
   * Score all 5 arms for every candidate day. `state` is keyed by arm; an entry
   * with empty `A`/`b` is the cold prior. Returns `null` on any failure.
   */
  async predict(
    contexts: { day: string; x: number[] }[],
    state: Record<SchedulingArm, BanditArmStateWire>,
  ): Promise<Record<string, Record<SchedulingArm, number>> | null> {
    if (!this.baseUrl) return null;

    const body: BanditPredictRequest = {
      alpha: BANDIT_ALPHA,
      ridge: BANDIT_RIDGE,
      state,
      contexts,
    };

    const res = await this.post<BanditPredictResponse>("/predict", body);
    return res ? res.scores : null;
  }

  /**
   * Fold one `(x, reward)` observation into `arm`'s state and return the new
   * `(A, b)`. Returns `null` on any failure.
   */
  async update(
    arm: string,
    x: number[],
    reward: number,
    state: BanditArmStateWire,
  ): Promise<BanditUpdateResponse | null> {
    if (!this.baseUrl) return null;

    const body: BanditUpdateRequest = {
      ridge: BANDIT_RIDGE,
      arm,
      x,
      reward,
      state,
    };

    return this.post<BanditUpdateResponse>("/update", body);
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `bandit ${path} returned ${res.status}; falling back to heuristic`,
        );
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(
        `bandit ${path} unreachable (${(err as Error).message}); falling back to heuristic`,
      );
      return null;
    }
  }
}
