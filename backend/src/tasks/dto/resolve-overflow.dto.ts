import { IsIn, IsOptional } from "class-validator";
import { VIEW_MODES, type ViewMode } from "@zenflow/shared";

/** The recovery options offered when a task can't be placed before its deadline. */
const OVERFLOW_CHOICES = ["outsideHours", "nextAvailable"] as const;
export type OverflowChoice = (typeof OVERFLOW_CHOICES)[number];

/**
 * Body for `PATCH /tasks/:id/resolve-overflow`: which recovery option the user
 * accepted from the create-overflow toast, plus the calendar view that drives
 * the "next available period" granularity (defaults to "day").
 */
export class ResolveOverflowDto {
  @IsIn(OVERFLOW_CHOICES)
  choice: OverflowChoice;

  @IsOptional()
  @IsIn(VIEW_MODES)
  view?: ViewMode;
}
