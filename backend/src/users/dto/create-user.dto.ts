import { IsEmail, IsString, Length } from "class-validator";
import { IsValidTimezone } from "src/common/validators/valid-timezone.decorator";

export class CreateUserDto {
  @IsEmail()
  @Length(1, 255)
  email: string;

  @IsString()
  @IsValidTimezone()
  timezone: string;
}
