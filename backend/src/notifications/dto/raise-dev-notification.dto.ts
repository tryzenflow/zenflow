import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

/**
 * Body for the dev-only `POST /notifications/dev/raise` — see
 * {@link NotificationsController.devRaise} and
 * `scripts/send-test-notification.ts`.
 */
export class RaiseDevNotificationDto {
  /** The `User.id` to raise the fake notifications for. */
  @IsUUID()
  userId!: string;

  /** How many to raise, cycling the sample styles. Defaults to 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;
}
