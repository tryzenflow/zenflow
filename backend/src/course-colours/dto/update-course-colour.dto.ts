import { IsInt, Max, Min } from "class-validator";
import {
  COURSE_COLOUR_SWATCH_COUNT,
  type UpdateCourseColourInput,
} from "@zenflow/shared";

export class UpdateCourseColourDto implements UpdateCourseColourInput {
  @IsInt()
  @Min(0)
  @Max(COURSE_COLOUR_SWATCH_COUNT - 1)
  swatch!: number;
}
