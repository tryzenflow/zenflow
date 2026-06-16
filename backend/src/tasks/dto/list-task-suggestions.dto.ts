import { Transform, Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/** Query params for GET /tasks/suggestions (title autocomplete). */
export class ListTaskSuggestionsDto {
  /** The text typed so far; matched case-insensitively against the title. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @MaxLength(200)
  q?: string;

  /** Max number of distinct-title suggestions to return. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
