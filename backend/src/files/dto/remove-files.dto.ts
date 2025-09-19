import { Transform } from "class-transformer";
import { ArrayMinSize, IsArray, IsUUID } from "class-validator";

export class RemoveFilesDto {
  @Transform(({ value }) => value?.split(","))
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  ids: string[];
}
