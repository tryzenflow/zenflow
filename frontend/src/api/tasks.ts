import { format } from "date-fns";
import { api } from "./base";
import type {
  CreateTaskInput,
  CreateTaskResponse,
  DeadlineOptionsResponse,
  DisplacedTask,
  RescheduleCascadeInput,
  RescheduleResponse,
  SimulateTaskInput,
  SimulateTaskResponse,
  Task,
  TaskDetailResponse,
  TasksListResponse,
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

/** Read-only dry-run of the scheduler for a not-yet-created task. Never writes to the DB. */
export async function simulateTask(
  input: SimulateTaskInput,
): Promise<SimulateTaskResponse> {
  const { data } = await api.post("/tasks/simulate", input);
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
 * The shared confirm-before-reschedule target for a deadline edit, a
 * tags-driven duration change, or a delete's gap-fill — no anchor task, every
 * non-frozen task currently placed inside `input`'s window is eligible.
 */
export async function rescheduleCascade(
  input: RescheduleCascadeInput,
): Promise<{ displaced: DisplacedTask[] }> {
  const { data } = await api.post("/tasks/reschedule-cascade", input);
  return data.data;
}

export async function resolveOverflow(
  id: string,
  choice: "outsideHours" | "nextAvailable",
): Promise<RescheduleResponse> {
  const { data } = await api.patch(`/tasks/${id}/resolve-overflow`, {
    choice,
  });
  return data.data;
}

export async function completeTask(id: string): Promise<Task> {
  const { data } = await api.patch(`/tasks/${id}/complete`);
  return data.data;
}

/**
 * Deletes the task. Never cascades — the caller is responsible for capturing
 * the task's placement BEFORE calling this (e.g. from already-loaded task
 * state) and, if it's still in the future, offering a gap-fill reschedule via
 * {@link rescheduleCascade}.
 */
export async function removeTask(id: string): Promise<void> {
  await api.delete(`/tasks/${id}`);
}
