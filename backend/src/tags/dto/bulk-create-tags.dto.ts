import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from "class-validator";
import {
  BULK_TAGS_MAX,
  TAG_NAME_MAX,
  type BulkCreateTagsInput,
} from "@zenflow/shared";

export class BulkCreateTagsDto implements BulkCreateTagsInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_TAGS_MAX)
  @IsString({ each: true })
  @MaxLength(TAG_NAME_MAX, { each: true })
  names!: string[];
}
