import { api } from "./base";

/** Mark one session done (`complete`) or missed (`skip`). Idempotent on the server. */
export async function markSession(
  id: string,
  kind: "complete" | "skip",
): Promise<void> {
  await api.post(`/sessions/${encodeURIComponent(id)}/${kind}`);
}
