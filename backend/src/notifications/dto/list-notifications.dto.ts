import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** Query params for `GET /notifications`. */
export class ListNotificationsDto {
  /** Page size. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /**
   * How many notifications to skip.
   *
   * Offset rather than a cursor because the inbox is sorted unread-first: a
   * cursor over a two-key sort whose first key *changes when the user reads a
   * row* would skip or repeat entries as they page.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
