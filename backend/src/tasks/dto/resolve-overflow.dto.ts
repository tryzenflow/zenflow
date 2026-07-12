import { IsIn } from "class-validator";

/** The recovery options offered when a task can't be placed before its deadline. */
const OVERFLOW_CHOICES = ["outsideHours", "nextAvailable"] as const;
export type OverflowChoice = (typeof OVERFLOW_CHOICES)[number];

/**
 * Body for `PATCH /tasks/:id/resolve-overflow`: which recovery option the user
 * accepted from the overflow toast.
 */
export class ResolveOverflowDto {
  @IsIn(OVERFLOW_CHOICES)
  choice: OverflowChoice;
}
