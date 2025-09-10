import { Matches } from "class-validator";

export class FindSchedulesDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end: string;
}
