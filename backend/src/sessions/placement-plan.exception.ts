import { ConflictException } from "@nestjs/common";
import {
  PLACEMENT_NEEDS_CONFIRMATION_CODE,
  PLACEMENT_STALE_CODE,
  type PlacementNeedsConfirmationError,
  type PlacementPlan,
  type PlacementStaleError,
} from "@zenflow/shared";

export const PLACEMENT_NEEDS_CONFIRMATION_MESSAGE =
  "This move needs your confirmation\nIt moves a task you set a time for.";

export const PLACEMENT_STALE_MESSAGE =
  "This plan is out of date\nCheck the calendar and try again.";

/**
 * 409 raised by `POST /sessions` when the only plan moves a `CHOSEN` session.
 * Nothing was persisted; the body carries the plan to confirm.
 */
export class PlacementNeedsConfirmationException extends ConflictException {
  constructor(plan: PlacementPlan) {
    // The plan rides in `data`: the error filter forwards `code` and `data`.
    const body: PlacementNeedsConfirmationError = {
      success: false,
      statusCode: 409,
      message: PLACEMENT_NEEDS_CONFIRMATION_MESSAGE,
      code: PLACEMENT_NEEDS_CONFIRMATION_CODE,
      data: { plan },
    };
    super(body);
  }
}

/**
 * 409 raised by `POST /sessions/placement/confirm` when the plan no longer
 * holds (moved session changed, slot taken, or expired). Nothing was applied.
 */
export class PlacementStaleException extends ConflictException {
  constructor(message: string = PLACEMENT_STALE_MESSAGE) {
    const body: PlacementStaleError = {
      success: false,
      statusCode: 409,
      message,
      code: PLACEMENT_STALE_CODE,
    };
    super(body);
  }
}
