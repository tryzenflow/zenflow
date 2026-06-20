import { api } from "./base";
import type {
  OnboardingInput,
  UpdatePreferencesInput,
  User,
} from "@zenflow/shared";
import type { PreferenceMatrixResponse } from "@/types/phase2";

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

/**
 * The current user's 672-cell signed preference matrix for the Insights
 * heatmap (fetch-on-open). Row-major [day0..6][block0..95]; a cold-start user
 * comes back all-zeros, which the heatmap renders as an empty state.
 */
export async function getPreferenceMatrix(): Promise<PreferenceMatrixResponse> {
  const { data } = await api.get("/users/me/preference-matrix");
  return data.data;
}
