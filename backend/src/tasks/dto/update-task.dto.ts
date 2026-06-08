import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateIf,
} from "class-validator";
import type { UpdateTaskInput } from "@zenflow/shared";

/** Metadata-only update. Does NOT trigger rescheduling (see docs ADR/api-contracts). */
export class UpdateTaskDto implements UpdateTaskInput {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  note?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  deadline?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
