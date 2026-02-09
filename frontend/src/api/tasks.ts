import { CreateTaskDto, Task, UpdateTaskDto } from "@/types/tasks";
import { api } from "./base";
import { DateRangeDto } from "@/types/date";

export async function createTask(createTaskDto: CreateTaskDto): Promise<Task> {
  const { data } = await api.post("/tasks", createTaskDto);
  return data.data;
}

export async function updateTask(
  id: string,
  updateTaskDto: UpdateTaskDto,
): Promise<Task> {
  const { data } = await api.patch(`/tasks/${id}`, updateTaskDto);
  return data.data;
}

export async function getTaskDetails(id: string): Promise<Task | null> {
  const { data } = await api.get(`/tasks/${id}/details`);
  return data.data;
}

export async function getRecurringTasks(
  dateRangeDto: DateRangeDto,
): Promise<Task[]> {
  const { data } = await api.get("/tasks/recurring", {
    params: dateRangeDto,
  });
  return data.data;
}
