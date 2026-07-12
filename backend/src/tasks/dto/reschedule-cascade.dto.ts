import { IsBoolean, IsISO8601, IsOptional } from "class-validator";
import type { RescheduleCascadeInput } from "@zenflow/shared";

/**
 * Body for `POST /tasks/reschedule-cascade`: the shared confirm-before-
 * reschedule target for a deadline edit, a tags-driven duration change, or a
 * delete — no anchor task, every non-frozen task in the window is eligible.
 */
export class RescheduleCascadeDto implements RescheduleCascadeInput {
  @IsISO8601()
  windowStart: string;

  @IsISO8601()
  windowEnd: string;

  /**
   * The 3-option manual-vs-auto reschedule choice (todo.md §Rescheduling
   * Design): true reschedules manually-moved tasks too; false/omitted keeps
   * them frozen.
   */
  @IsOptional()
  @IsBoolean()
  includeManual?: boolean;
}
