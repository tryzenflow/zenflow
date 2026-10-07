import { IsEmail, IsIn, IsOptional, IsString, Length } from "class-validator";
import { LANGS, type Lang } from "@zenflow/shared";

export class RequestOTPDto {
  @IsEmail()
  @IsString()
  @Length(1, 255)
  email: string;

  /** Language picked on the login screen; the account may not exist yet. */
  @IsIn(LANGS)
  @IsOptional()
  lang?: Lang;
}
