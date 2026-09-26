import { ConflictException } from "@nestjs/common";
import { SLOT_TAKEN_CODE, type SlotTakenError } from "@zenflow/shared";

export const SLOT_TAKEN_MESSAGE =
  "That alternative time now overlaps another sitting of this task.";

/**
 * 409 raised by `POST /sessions/:id/slot-pick` (`chose: "alternative"`) when a
 * `TASK` series sitting's alternative overlaps another non-deleted sitting of
 * the same series (#58). The body is the shared {@link SlotTakenError};
 * nothing was moved or recorded.
 */
export class SlotTakenException extends ConflictException {
  constructor() {
    const body: SlotTakenError = {
      success: false,
      statusCode: 409,
      message: SLOT_TAKEN_MESSAGE,
      code: SLOT_TAKEN_CODE,
    };
    super(body);
  }
}
