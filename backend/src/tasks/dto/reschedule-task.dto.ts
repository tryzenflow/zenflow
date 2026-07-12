import { IsISO8601 } from "class-validator";
import type { RescheduleInput } from "@zenflow/shared";

/** Manual drag-to-reschedule from the calendar; pins the task (manuallyMoved). */
export class RescheduleTaskDto implements RescheduleInput {
  @IsISO8601()
  requestedStartTime: string;
}
