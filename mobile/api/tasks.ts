import { format } from "date-fns";
import { api } from "./base";
import type {
  CreateTaskInput,
  CreateTaskResponse,
  DeadlineOptionsResponse,
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

export async function listTaskSuggestions(q: string, limit = 10): Promise<Task[]> {
  const { data } = await api.get("/tasks/suggestions", { params: { q, limit } });
  return data.data.suggestions;
}

export async function createTask(input: CreateTaskInput): Promise<CreateTaskResponse> {
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
  const { data } = await api.get("/tasks/deadline-options", { params: { anchor } });
  return data.data;
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<UpdateTaskResponse> {
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
  const { data } = await api.patch(`/tasks/${id}/reschedule`, { requestedStartTime });
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
 * ran (see `UpdateTaskResponse.batchId` / `RescheduleResponse.batchId`) —
 * reverts every task that batch moved back to its prior slot/duration.
 */
export async function undoBatch(batchId: string): Promise<UndoBatchResponse> {
  const { data } = await api.post(`/tasks/reschedule/undo/${batchId}`);
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
