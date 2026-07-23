import { format } from "date-fns";
import { api } from "./base";
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
 * Undo a batch of RESCHEDULED events tagged with `batchId` — currently only
 * produced by Optimize apply (see `optimizeApply`). Reverts every touched
 * task back to its prior slot/duration.
 *
 * If any touched row was mutated again since the batch ran, the backend
 * returns `{ requiresConfirmation: true, touchedTaskIds }` instead of
 * writing anything; resubmit with an explicit `strategy` ("all" to revert
 * everything anyway, "excludeTouched" to skip the rows touched since) to
 * proceed.
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
 * Edit-accept flow: after `PATCH /tasks/:id` flags a task `conflict: true`
 * because the new deadline/duration broke its current slot, calling this
 * (no body — the backend reads the task's current deadline/duration itself)
 * runs the same Tier1→2→3 search `createTask` uses and clears the flag on
 * success.
 */
export async function resolveTaskPlacement(
  id: string,
): Promise<RescheduleResponse> {
  const { data } = await api.post(`/tasks/${id}/reschedule/resolve`);
  return data.data;
}

/**
 * Count-only preview for the Optimize action — never returns a diff (no
 * per-task preview UI is ever built for Optimize), just how many tasks in
 * the window would move under the given mode. Used solely to decide whether
 * to show the large-batch guard confirm before calling `optimizeApply`.
 */
export async function optimizePreview(
  input: OptimizeWindowInput,
): Promise<OptimizePreviewResponse> {
  const { data } = await api.post("/tasks/optimize/preview", input);
  return data.data;
}

/** Runs the Optimize repack for real, writing placements under one fresh `batchId`. */
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
