import { api } from "./base";
import type {
  OnboardingInput,
  PreferenceMatrixResponse,
  TagBiasResponse,
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

/**
 * The current user's flat 168-element signed preference matrix for the
 * Insights heatmap (fetch-on-open). A cold-start user comes back all-zeros.
 */
export async function getPreferenceMatrix(): Promise<PreferenceMatrixResponse> {
  const { data } = await api.get("/users/me/preference-matrix");
  return data.data;
}

/**
 * Per-tag learned duration multipliers for the Insights panel. Sorted by
 * sample count descending; an empty `tags` array means no tag history yet.
 */
export async function getTagBias(): Promise<TagBiasResponse> {
  const { data } = await api.get("/users/me/tag-bias");
  return data.data;
}
