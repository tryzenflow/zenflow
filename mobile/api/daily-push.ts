import type { DailyPushSettings, UpdateDailyPushInput } from "@zenflow/shared";
import { api } from "./base";

/** The morning brief and evening check-in times (`null` = off). */
export async function getDailyPush(): Promise<DailyPushSettings> {
  const { data } = await api.get("/users/me/daily-push");
  return data.data;
}

export async function updateDailyPush(
  input: UpdateDailyPushInput,
): Promise<DailyPushSettings> {
  const { data } = await api.put("/users/me/daily-push", input);
  return data.data;
}
