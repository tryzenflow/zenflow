import { api } from "./base";
import type {
  OnboardingInput,
  UpdatePreferencesInput,
  User,
} from "@zenflow/shared";

export async function completeOnboarding(
  input: OnboardingInput,
): Promise<User> {
  const { data } = await api.post("/users/me/onboarding", input);
  return data.data;
}

export async function updatePreferences(
  input: UpdatePreferencesInput,
): Promise<User> {
  const { data } = await api.put("/users/me/preferences", input);
  return data.data;
}
