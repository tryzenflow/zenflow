import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * 429 for "this provider was synced too recently" — by anyone, the ticker
 * included. Carries the wait so the global `AllExceptionsFilter` emits
 * `Retry-After` (seconds), the same way it does for an open breaker.
 */
export class SyncCooldownException extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(label: string, retryAfterMs: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    const minutes = Math.ceil(seconds / 60);
    super(
      {
        message: `${label} was synced a moment ago. Try again in ${minutes} min.`,
        code: "SYNC_COOLDOWN",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.retryAfterSeconds = seconds;
  }
}
