import { IsISO8601, IsOptional } from "class-validator";

/**
 * Optional calendar-view bounds a caller can supply (as query params) to scope
 * the view-scoped `cascadeReschedule` a mutation triggers — used by
 * `PATCH /tasks/:id/complete` and `DELETE /tasks/:id`, mirroring the
 * `viewStart`/`viewEnd` already accepted by `POST /tasks` and
 * `PATCH /tasks/:id/reschedule`. Omitting both falls back to the unscoped
 * (full) cascade.
 */
export class ViewBoundsDto {
  @IsOptional()
  @IsISO8601()
  viewStart?: string;

  @IsOptional()
  @IsISO8601()
  viewEnd?: string;
}
