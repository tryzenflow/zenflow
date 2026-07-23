import { IsIn, IsISO8601 } from "class-validator";
import type { OptimizeWindowInput } from "@zenflow/shared";

/** Body for POST /tasks/optimize/preview and POST /tasks/optimize/apply. */
export class OptimizeWindowDto implements OptimizeWindowInput {
  @IsISO8601()
  windowStart: string;

  @IsISO8601()
  windowEnd: string;

  @IsIn(["full", "retainManual", "balanced"])
  mode: "full" | "retainManual" | "balanced";
}
