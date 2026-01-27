import { ScheduledBlock } from "./schedule";

export type Scale = 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  note?: string;
  rrule: string | null;
  duration: number;
  deadline?: string;
  energy: Scale;
  categoryId?: string;
  schedules?: ScheduledBlock[];
}

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
