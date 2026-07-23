import { IsIn, IsOptional } from "class-validator";
import type { UndoBatchInput } from "@zenflow/shared";

/** Optional body for POST /tasks/reschedule/undo/:batchId. */
export class UndoBatchDto implements UndoBatchInput {
  @IsOptional()
  @IsIn(["all", "excludeTouched"])
  strategy?: "all" | "excludeTouched";
}
