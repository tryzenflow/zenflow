import type {
  CreateTaskInput,
  CreateTaskResponse,
  DeadlineOptionsResponse,
  OptimizeApplyResponse,
  OptimizePreviewResponse,
  OptimizeWindowInput,
  RemoveTaskResponse,
  RescheduleResponse,
  Task,
  TaskDetailResponse,
  TasksListResponse,
  UndoBatchResponse,
  UpdateTaskInput,
  UpdateTaskResponse,
  ViewMode,
} from "@zenflow/shared";
import { format } from "date-fns";
import { api } from "./base";

export async function listTasks(
  view: ViewMode,
  date: Date,
  status?: "PENDING" | "DONE" | "all",
): Promise<TasksListResponse> {
  const { data } = await api.get("/tasks", {
    params: { view, date: format(date, "yyyy-MM-dd"), status },
  });
  return data.data;
}

export async function listTaskSuggestions(
  q: string,
  limit = 10,
): Promise<Task[]> {
  const { data } = await api.get("/tasks/suggestions", {
    params: { q, limit },
  });
  return data.data.suggestions;
}

export async function createTask(
  input: CreateTaskInput,
): Promise<CreateTaskResponse> {
  const { data } = await api.post("/tasks", input);
  return data.data;
}

/**
 * The six deadline quick-action chip values (Today/Tomorrow/This week/Next
 * week/This month/No rush), each an ISO-8601 instant derived from the
 * backend's `endOfPeriod` ceiling math relative to `anchor`.
 */
export async function getDeadlineOptions(
  anchor: string = new Date().toISOString(),
): Promise<DeadlineOptionsResponse> {
  const { data } = await api.get("/tasks/deadline-options", {
    params: { anchor },
  });
  return data.data;
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<UpdateTaskResponse> {
  const { data } = await api.patch(`/tasks/${id}`, input);
  return data.data;
}

export async function getTaskDetails(id: string): Promise<TaskDetailResponse> {
  const { data } = await api.get(`/tasks/${id}`);
  return data.data;
}

export async function rescheduleTask(
  id: string,
  requestedStartTime: string,
): Promise<RescheduleResponse> {
  const { data } = await api.patch(`/tasks/${id}/reschedule`, {
    requestedStartTime,
  });
  return data.data;
}

export async function resizeTask(
  id: string,
  requestedStartTime: string,
  durationMinutes: number,
): Promise<RescheduleResponse> {
  const { data } = await api.patch(`/tasks/${id}/resize`, {
    requestedStartTime,
    durationMinutes,
  });
  return data.data;
}

/**
 * Undo the inline narrow same-day auto-resolve a create/update/drag/resize
 * ran (see `UpdateTaskResponse.batchId` / `RescheduleResponse.batchId`), or an
 * Optimize-apply batch (`OptimizeApplyResponse.batchId`) — reverts every task
 * that batch moved back to its prior slot/duration.
 *
 * If any row in the batch was touched by a later, differently-tagged event,
 * the backend returns `{ requiresConfirmation: true, touchedTaskIds }`
 * instead of writing anything; resubmit with an explicit `strategy` ("all" to
 * revert everyone anyway, "excludeTouched" to only revert untouched rows).
 */
export async function undoBatch(
  batchId: string,
  strategy?: "all" | "excludeTouched",
): Promise<UndoBatchResponse> {
  const { data } = await api.post(
    `/tasks/reschedule/undo/${batchId}`,
    strategy ? { strategy } : undefined,
  );
  return data.data;
}

/**
 * Edit-accept flow: re-runs the same Tier1→2→3 single-task placement search
 * `POST /tasks` uses, over `[now, task's current deadline]` — only meaningful
 * when the task is currently flagged `conflict: true` by a prior metadata-only
 * edit that invalidated its slot. No body: the backend reads the task's own
 * current deadline/duration.
 */
export async function resolveTaskPlacement(
  id: string,
): Promise<RescheduleResponse> {
  const { data } = await api.post(`/tasks/${id}/reschedule/resolve`);
  return data.data;
}

/**
 * Count-only dry run for the Optimize action — never returns a per-task diff
 * (explicitly out of scope, see `mobile/README.md`/the scheduler redesign
 * plan). Used to decide whether to show the large-batch guard
 * (`OPTIMIZE_LARGE_BATCH_THRESHOLD`) before calling `optimizeApply`.
 */
export async function optimizePreview(
  input: OptimizeWindowInput,
): Promise<OptimizePreviewResponse> {
  const { data } = await api.post("/tasks/optimize/preview", input);
  return data.data;
}

/**
 * Recomputes the window server-side (same tiering as `optimizePreview`, not
 * trusting the earlier preview count) and writes the result, tagging one
 * fresh `batchId` so the whole action is undoable via `undoBatch`.
 */
export async function optimizeApply(
  input: OptimizeWindowInput,
): Promise<OptimizeApplyResponse> {
  const { data } = await api.post("/tasks/optimize/apply", input);
  return data.data;
}

export async function completeTask(id: string): Promise<Task> {
  const { data } = await api.patch(`/tasks/${id}/complete`);
  return data.data;
}

/**
 * Deletes the task. The backend already reoptimizes the pending schedule
 * inline after a delete — this response surfaces what that repack did, if
 * anything (`displaced`/`batchId`), same as create/update/reschedule/resize.
 */
export async function removeTask(id: string): Promise<RemoveTaskResponse> {
  const { data } = await api.delete(`/tasks/${id}`);
  return data.data;
}
