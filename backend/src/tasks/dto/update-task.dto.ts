import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateIf,
} from "class-validator";
import type { UpdateTaskInput } from "@zenflow/shared";

/**
 * Metadata-only update: title/note/deadline/tags are saved immediately and the
 * task keeps its current slot. A `deadline` change is saved but no longer
 * auto-cascades — see `UpdateTaskResponse.deadlineChanged` and
 * `POST /tasks/:id/reschedule-cascade`. A `tags` change may surface a duration
 * correction via `UpdateTaskResponse.schedulingMeta`.
 */
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
