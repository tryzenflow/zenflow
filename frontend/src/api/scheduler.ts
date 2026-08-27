import type { OptimizeResponse, UndoOptimizeResponse } from "@zenflow/shared";
import { api } from "./base";

/**
 * `POST /scheduler/optimize` — the new, minimal auto-placement pass (trigger
 * 4 from notes.md). This is NOT the old EDF-era `optimizePreview`/
 * `optimizeApply` flow that used to live in `tasks.ts` (deleted along with
 * the EDF scheduler engine, see `frontend/README.md`) — it applies
 * immediately, no separate preview step, and only ever touches `PENDING`
 * sessions inside `[start, end]`.
 */
export async function optimizeSchedule(
  start: Date,
  end: Date,
): Promise<OptimizeResponse> {
  const { data } = await api.post("/scheduler/optimize", {
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return data.data;
}

/**
 * `POST /scheduler/optimize/undo/:batchId` — unconditionally reverts every
 * session an `optimizeSchedule` call moved, back to its prior
 * `scheduledStartTime`. No conflict detection on the way back.
 */
export async function undoOptimize(
  batchId: string,
): Promise<UndoOptimizeResponse> {
  const { data } = await api.post(`/scheduler/optimize/undo/${batchId}`);
  return data.data;
}
