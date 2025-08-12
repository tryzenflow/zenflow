import { IsEmail, IsString, Length, Matches } from "class-validator";

export class VerifyOTPDto {
  @IsEmail()
  @IsString()
  @Length(1, 30)
  email: string;

  @IsString()
  @Matches(/\d{6}/, { message: "Invalid OTP provided" })
  providedOtp: string;
}
