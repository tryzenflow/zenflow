import { api } from "./base";
import type { PreferenceMatrixResponse } from "@zenflow/shared";

// No `completeOnboarding`/`updatePreferences` — there is no onboarding flow
// and no user-editable work-hours preferences anymore (both `workStart`/
// `workEnd`/`workDays` and `onboardingComplete` were dropped from `User`
// with no replacement — see `@zenflow/shared`'s `user.ts`). Timezone is
// captured once at OTP signup via the `x-timezone` header (`api/auth.ts`)
// and isn't editable after that.

/**
 * The current user's 168-cell (7 days × 24 one-hour buckets) signed
 * preference matrix for the Insights heatmap (fetch-on-open). Row-major
 * [day0..6][block0..23]; a cold-start user comes back all-zeros, which the
 * heatmap renders as an empty state.
 */
export async function getPreferenceMatrix(): Promise<PreferenceMatrixResponse> {
  const { data } = await api.get("/users/me/preference-matrix");
  return data.data;
}
