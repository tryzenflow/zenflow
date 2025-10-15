export interface Task {
  id: string;
  title: string;
  note?: string;
  duration: number;
  priority?: number;
  earliestStart?: number;
  latestEnd?: number;
  deadline?: string;
  mandatory?: boolean;
  maxSplits?: number;
  focus?: number;
  categoryId?: string;
  prerequisites?: string[];
}

export interface TasksResponse {
  data: Task[];
  message: string;
  success: boolean;
}
