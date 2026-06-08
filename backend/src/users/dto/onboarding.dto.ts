import { UpdatePreferencesDto } from "./update-preferences.dto";
import type { OnboardingInput } from "@zenflow/shared";

export class OnboardingDto
  extends UpdatePreferencesDto
  implements OnboardingInput {}
