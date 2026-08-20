import { api } from "./base";
import type {
  OnboardingInput,
  UpdatePreferencesInput,
  UpdateUserInput,
  User,
} from "@zenflow/shared";

/** The current user's full record, including preferences. */
export async function getMe(): Promise<User> {
  const { data } = await api.get("/users/me");
  return data.data;
}

export async function completeOnboarding(input: OnboardingInput): Promise<User> {
  const { data } = await api.post("/users/me/onboarding", input);
  return data.data;
}

export async function updatePreferences(input: UpdatePreferencesInput): Promise<User> {
  const { data } = await api.put("/users/me/preferences", input);
  return data.data;
}

export async function updateBasicInfo(input: UpdateUserInput): Promise<User> {
  const { data } = await api.patch("/users/update/basic-info", input);
  return data.data;
}
