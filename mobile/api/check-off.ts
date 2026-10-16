import type { SessionCheckOffResponse } from "@zenflow/shared";
import { api } from "./base";
import { notifySessionsMutated } from "@/lib/session-cache";

/**
 * Set or undo a done (`complete`) or missed (`skip`) state. Returns the updated
 * session and the user's streak (`{ session, streak }`).
 */
export async function checkOff(
  id: string,
  kind: "complete" | "skip",
  on: boolean,
): Promise<SessionCheckOffResponse> {
  const path = `/sessions/${encodeURIComponent(id)}/${kind}`;
  const { data } = on ? await api.post(path) : await api.delete(path);
  notifySessionsMutated();
  return data.data;
}

/** Mark one session done or missed without reading the response. Idempotent on the server. */
export async function markSession(
  id: string,
  kind: "complete" | "skip",
): Promise<void> {
  await checkOff(id, kind, true);
}
