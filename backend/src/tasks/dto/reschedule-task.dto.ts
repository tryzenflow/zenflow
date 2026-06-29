import { IsISO8601, IsOptional } from "class-validator";
import type { RescheduleInput } from "@zenflow/shared";

export class RescheduleTaskDto implements RescheduleInput {
  @IsISO8601()
  requestedStartTime: string;

  @IsOptional()
  @IsISO8601()
  viewStart?: string;

  @IsOptional()
  @IsISO8601()
  viewEnd?: string;
}
