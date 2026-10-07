import { Transform } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from "class-validator";
import {
  DEFAULT_REMINDER_CHOICES,
  LANGS,
  TIP_IDS,
  type TipId,
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

  // Keep the raw value: implicit conversion would turn any non-empty string into `true`.
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  @IsOptional()
  allowNotifications?: boolean;

  /** Marks one getting-started checklist step done, or the checklist hidden (idempotent). */
  @IsIn(TIP_IDS)
  @IsOptional()
  seenTip?: TipId;
}
