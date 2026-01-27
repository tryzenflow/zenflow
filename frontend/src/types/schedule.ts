import { Scale } from "./tasks";

export interface ScheduledBlock {
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

export interface GetSchedulesResponse {
  success: boolean;
  message: string;
  data: ScheduledBlock[];
}

export interface ScheduleResponse {
  success: boolean;
  message: string;
  feasible: boolean;
  data: ScheduledBlock[];
}

export type ViewMode = "day" | "week" | "month";
