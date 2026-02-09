import { Interval } from "../../common/interfaces/interval.interface";

export interface Task {
  id: string;
  title: string;
  duration: number;
  deadline?: number;
  energy: number;
  maxSplits: number;
  categoryId?: string;
  events?: Event[];
  fixedWindow?: Interval;
}

export interface Event {
  id: string;
  taskId: string;
  splitIndex: number;
  start: number;
  end: number | null;
}

export interface ScheduleRequest {
  minTime: number;
  userPreference: {
    energyZones: {
      level: number;
      interval: Interval;
    }[];
    breakMinutes: number;
  };
  tasks: Task[];
}

export interface ScheduleResponse {
  events: Event[];
}
