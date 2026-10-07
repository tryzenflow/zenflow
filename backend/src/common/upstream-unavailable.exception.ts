import { ServiceUnavailableException } from "@nestjs/common";

/**
 * 503 for "an external API's circuit breaker is open". Carries the wait so the
 * global `AllExceptionsFilter` can emit a `Retry-After` header (seconds).
 * Deliberately unrelated to the rate limiter's 429 / `TooManyRequestsFilter`.
 */
export class UpstreamUnavailableHttpException extends ServiceUnavailableException {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterMs: number) {
    super({ message, code: "UPSTREAM_UNAVAILABLE" });
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}
