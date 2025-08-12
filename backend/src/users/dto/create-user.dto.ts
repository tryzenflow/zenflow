import { IsEmail, IsString, Length } from "class-validator";

export class CreateUserDto {
  @Length(1, 50)
  @IsString()
  timezone: string;

  @IsEmail()
  email: string;
}
