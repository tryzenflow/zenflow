import { Event } from "./schedule";

export type Scale = 1 | 2 | 3;

export interface FixedWindow {
  start: number;
  end: number;
}

export interface Task {
  id: string;
  title: string;
  note?: string;
  rrule: string | null;
  duration: number;
  deadline?: string;
  energy: Scale;
  categoryId?: string;
  schedules?: Event[];
}

export interface CreateTaskDto {
  title: string;
  note?: string;
  rrule?: string;
  scheduleDate: string;
  duration: number;
  deadline?: string;
  energy: Scale;
  categoryId?: string;
  fixedWindow?: FixedWindow;
}

export interface UpdateTaskDto extends Omit<CreateTaskDto, "scheduleDate"> {}

export interface Category {
  id: string;
  name: string;
}

export interface TaskResponse {
  data: Task;
  message: string;
  success: boolean;
}

export interface TasksResponse {
  data: Task[];
  message: string;
  success: boolean;
}
