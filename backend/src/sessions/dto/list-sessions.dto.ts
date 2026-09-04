import { IsDateString, IsIn, MaxLength } from "class-validator";
import type { ViewMode } from "@zenflow/shared";

export class ListSessionsDto {
  @IsIn(["day", "week", "month"])
  view: ViewMode;

  @IsDateString()
  @MaxLength(10)
  date: string;
}
