import { IsEmail, IsString, Length } from "class-validator";

export class RequestOTPDto {
  @IsEmail()
  @IsString()
  @Length(1, 255)
  email: string;
}
