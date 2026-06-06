import { IsDateString, IsIn, IsOptional, MaxLength } from "class-validator";
import type { ViewMode } from "@zenflow/shared";

export class ListTasksDto {
  @IsIn(["day", "week", "month"])
  view: ViewMode;

  @IsDateString()
  @MaxLength(10)
  date: string;

  @IsOptional()
  @IsIn(["PENDING", "DONE", "all"])
  status?: "PENDING" | "DONE" | "all";
}
