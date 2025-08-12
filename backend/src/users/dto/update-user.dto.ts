import { IsString, Length } from "class-validator";

export class UpdateUserDto {
  @IsString()
  @Length(1, 30)
  name: string;
}
