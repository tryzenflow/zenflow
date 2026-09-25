import { ServiceUnavailableException } from "@nestjs/common";
import {
  SCHEDULER_DEGRADED_CODE,
  type SchedulerDegradedError,
} from "@zenflow/shared";

export const DEGRADED_MESSAGE =
  "Scheduling is temporarily limited\nNo free slot could be found with basic scheduling. Please try again shortly.";

/**
 * 503 raised in `python` placement mode when the placement service is
 * unavailable and the frozen heuristic fallback found no free slot before the
 * deadline (ADR-0003 2.4). Retryable; raised by pre-flights before anything is
 * written. The body is the shared {@link SchedulerDegradedError}.
 */
export class SchedulerDegradedException extends ServiceUnavailableException {
  constructor() {
    const body: SchedulerDegradedError = {
      success: false,
      statusCode: 503,
      message: DEGRADED_MESSAGE,
      code: SCHEDULER_DEGRADED_CODE,
    };
    super(body);
  }
}
