import { Scale } from "./tasks";

export interface Event {
  id: string;
  start: string; // date string
  splitIndex: number;
  end: string; // date string
  task: {
    id: string;
    title: string;
    energy: Scale;
    duration: number;
    rrule: string | null;
  };
}

export interface ScheduleDto {
  scheduleDate: string;
  keepManual: boolean;
  minTime: number;
}

export interface GetSchedulesResponse {
  success: boolean;
  message: string;
  data: Event[];
}

export interface ScheduleResponse {
  success: boolean;
  message: string;
  feasible: boolean;
  data: Event[];
}

export interface UpdateEventDto {
  date: string;
  interval?: {
    start: number;
    end: number;
  };
  completed?: boolean;
}

export type ViewMode = "day" | "week" | "month";
