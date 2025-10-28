import { Schedule } from "./schedule";

export type Scale = 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  note?: string;
  rrule?: string;
  duration: number;
  priority: Scale;
  earliestStart?: number;
  latestEnd?: number;
  deadline?: string;
  mandatory: boolean;
  maxSplits: number;
  focus: Scale;
  categoryId?: string;
  prerequisites?: (string | Task)[];
  schedules?: Schedule[];
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
