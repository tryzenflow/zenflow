import { ConflictException } from "@nestjs/common";
import {
  SCHEDULE_INFEASIBLE_CODE,
  type InfeasiblePolicy,
  type ScheduleInfeasibleError,
} from "@zenflow/shared";

export const INFEASIBLE_MESSAGE =
  "No conflict-free slot before the deadline\nAccept conflicts, or accept a late deadline.";

/**
 * 409 raised when a TASK create/edit has no slot before its deadline even after
 * flexible tasks were repacked and the request carried no `infeasiblePolicy`.
 * The body is the shared {@link ScheduleInfeasibleError}; nothing was persisted.
 */
export class ScheduleInfeasibleException extends ConflictException {
  constructor() {
    const body: ScheduleInfeasibleError = {
      success: false,
      statusCode: 409,
      message: INFEASIBLE_MESSAGE,
      code: SCHEDULE_INFEASIBLE_CODE,
      options: [
        "ACCEPT_CONFLICTS",
        "ACCEPT_LATE_DEADLINE",
      ] as InfeasiblePolicy[],
    };
    super(body);
  }
}
