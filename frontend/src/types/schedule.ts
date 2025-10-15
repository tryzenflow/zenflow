export interface Schedule {
  taskId: string;
  start: string | null;
  split: number;
  date: string;
  end: string | null;
  task: { id: string; title: string; focusLevel: 1 | 2 | 3; duration: number };
}

export interface SchedulesResponse {
  success: boolean;
  message: string;
  data: Schedule[];
}
