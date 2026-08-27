import type { UpdateUserInput, User } from "@zenflow/shared";
import { api } from "./base";

/** The current user's full record, including preferences. */
export async function getMe(): Promise<User> {
  const { data } = await api.get("/users/me");
  return data.data;
}

// No `completeOnboarding`/`updatePreferences` — there is no onboarding flow
// and no user-editable preferences anymore. Timezone is captured once at OTP
// signup via the `x-timezone` header (see `api/auth.ts`) and isn't editable
// after that.

export async function updateBasicInfo(input: UpdateUserInput): Promise<User> {
  const { data } = await api.patch("/users/update/basic-info", input);
  return data.data;
}
