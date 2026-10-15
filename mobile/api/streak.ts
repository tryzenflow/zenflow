import type { Streak } from "@zenflow/shared";
import { api } from "./base";

/** The signed-in user's daily completion streak. */
export async function getStreak(): Promise<Streak> {
  const { data } = await api.get("/users/me/streak");
  return data.data;
}
