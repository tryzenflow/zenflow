import { IsOptional, IsString, Length } from "class-validator";

export class UpdateUserDto {
  @IsString()
  @Length(1, 30)
  @IsOptional()
  name?: string;

  @IsString()
  @Length(1, 50)
  @IsOptional()
  timezone?: string;
}
