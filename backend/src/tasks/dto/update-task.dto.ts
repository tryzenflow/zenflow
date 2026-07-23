import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";
import type { UpdateTaskInput } from "@zenflow/shared";

/**
 * Metadata-only update: title/note/deadline/tags are saved immediately. A
 * `deadline`/duration change that leaves the task's own slot no longer
 * cost-optimal auto-resolves INLINE (same request) — see
 * `UpdateTaskResponse.displaced`/`batchId`. A `tags` change may surface a
 * duration correction via `UpdateTaskResponse.schedulingMeta`.
 */
export class UpdateTaskDto implements UpdateTaskInput {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: "Title must be at most 60 characters." })
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
