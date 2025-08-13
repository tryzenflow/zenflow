import { IsEmail, Length } from "class-validator";

export class CreateUserDto {
  @IsEmail()
  @Length(1, 30)
  email: string;
}
