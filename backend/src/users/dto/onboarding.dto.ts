import { IsOptional, IsString, ValidateIf } from "class-validator";
import { UpdatePreferencesDto } from "./update-preferences.dto";
import type { OnboardingInput } from "@zenflow/shared";

export class OnboardingDto
  extends UpdatePreferencesDto
  implements OnboardingInput
{
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  roleArchetypeId?: string | null;
}
