import type { Tag } from "@zenflow/shared";
import { api } from "./base";

/** The user's existing tags (name-sorted by the backend). */
export async function listTags(): Promise<Tag[]> {
  const { data } = await api.get("/tags");
  return data.data.tags;
}
