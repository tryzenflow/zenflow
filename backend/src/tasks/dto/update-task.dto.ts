import {
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateIf,
} from "class-validator";
import type { RecurrenceScope, UpdateTaskInput } from "@zenflow/shared";

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

  /** Recurring propagation; defaults to this occurrence only. */
  @IsOptional()
  @IsIn(["one", "following"])
  scope?: RecurrenceScope;
}
