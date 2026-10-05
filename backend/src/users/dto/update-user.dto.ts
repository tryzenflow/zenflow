import { Equals, IsIn, IsOptional, IsString, Length } from "class-validator";
import {
  DEFAULT_REMINDER_CHOICES,
  LANGS,
  type DefaultReminderChoice,
  type Lang,
  type UpdateUserInput,
} from "@zenflow/shared";
import { IsValidTimezone } from "../../common/validators/valid-timezone.decorator";

/** Partial update to a user's name and preferences. */
export class UpdateUserDto implements UpdateUserInput {
  @IsString()
  @Length(1, 60)
  @IsOptional()
  name?: string;

  @IsString()
  @Length(1, 50)
  @IsValidTimezone()
  @IsOptional()
  timezone?: string;

  @IsIn(LANGS)
  @IsOptional()
  lang?: Lang;

  @IsIn(DEFAULT_REMINDER_CHOICES)
  @IsOptional()
  defaultReminderMinutes?: DefaultReminderChoice;

  /** `true` completes onboarding (idempotent). */
  @Equals(true)
  @IsOptional()
  onboarded?: true;
}
