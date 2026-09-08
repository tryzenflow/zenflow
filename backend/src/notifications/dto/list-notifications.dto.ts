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
   * A plain offset: the inbox is a small, bounded list sorted newest-first, so
   * the extra machinery of a keyset cursor buys nothing here.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
