export type Scale = 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  note?: string;
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
}

export interface TasksResponse {
  data: Task[];
  message: string;
  success: boolean;
}
