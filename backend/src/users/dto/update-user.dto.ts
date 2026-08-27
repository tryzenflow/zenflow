import { IsOptional, IsString, Length } from "class-validator";
import type { UpdateUserInput } from "@zenflow/shared";

/**
 * Partial update to a user's basic identity. Timezone is set once at OTP
 * signup and is no longer editable here — no working-window/timezone
 * settings screen left to drive it (see `users.controller.ts`).
 */
export class UpdateUserDto implements UpdateUserInput {
  @IsString()
  @Length(1, 60)
  @IsOptional()
  name?: string;
}
