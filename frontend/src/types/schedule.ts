export interface Schedule {
  start: string | null;
  split: number;
  date: string;
  end: string | null;
  task: {
    id: string;
    title: string;
    focus: 1 | 2 | 3;
    duration: number;
    rrule: string | null;
  };
}

export interface GetSchedulesResponse {
  success: boolean;
  message: string;
  data: Schedule[];
}

export interface ScheduleResponse {
  success: boolean;
  message: string;
  feasible: boolean;
  data: Schedule[];
}
