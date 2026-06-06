import { IsISO8601 } from "class-validator";
import type { RescheduleInput } from "@zenflow/shared";

export class RescheduleTaskDto implements RescheduleInput {
  @IsISO8601()
  requestedStartTime: string;
}
