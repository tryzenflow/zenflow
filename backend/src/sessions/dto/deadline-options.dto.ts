import { IsISO8601 } from "class-validator";

/** Query params for `GET /tasks/deadline-options` (the deadline chip row). */
export class DeadlineOptionsDto {
  /** ISO-8601 instant the chip values are computed relative to (usually "now"). */
  @IsISO8601()
  anchor: string;
}
