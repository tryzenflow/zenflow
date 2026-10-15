import { Matches, ValidateIf } from "class-validator";
import type { UpdateDailyPushInput } from "@zenflow/shared";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Both push times; `null` turns that push off. A missing key is a 400. */
export class UpdateDailyPushDto implements UpdateDailyPushInput {
  @ValidateIf((o: UpdateDailyPushDto) => o.morningBriefTime !== null)
  @Matches(HHMM, { message: "morningBriefTime must be HH:mm or null" })
  morningBriefTime!: string | null;

  @ValidateIf((o: UpdateDailyPushDto) => o.eveningCheckinTime !== null)
  @Matches(HHMM, { message: "eveningCheckinTime must be HH:mm or null" })
  eveningCheckinTime!: string | null;
}
