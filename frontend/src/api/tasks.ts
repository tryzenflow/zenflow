import { format } from "date-fns";
import { api } from "./base";
import type {
  CreateTaskInput,
  CreateTaskResponse,
  RescheduleResponse,
  Task,
  TaskDetailResponse,
  TasksListResponse,
  UpdateTaskInput,
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

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
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

export async function resolveOverflow(
  id: string,
  choice: "outsideHours" | "nextAvailable",
  view?: "day" | "week" | "month",
): Promise<RescheduleResponse> {
  const { data } = await api.patch(`/tasks/${id}/resolve-overflow`, {
    choice,
    view,
  });
  return data.data;
}

export async function completeTask(id: string): Promise<Task> {
  const { data } = await api.patch(`/tasks/${id}/complete`);
  return data.data;
}

export async function removeTask(id: string): Promise<void> {
  await api.delete(`/tasks/${id}`);
}
