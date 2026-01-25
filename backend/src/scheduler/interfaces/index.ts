import { Interval } from "../../common/interfaces/interval.interface";

export interface Task {
  id: string;
  title: string;
  duration: number;
  deadline?: number;
  energy: number;
  maxSplits: number;
  categoryId?: string;
  scheduledBlocks?: ScheduledBlock[];
  fixedWindow?: Interval;
}

export interface ScheduledBlock {
  taskId: string;
  splitIndex: number;
  start: number;
  end: number;
}

export interface ScheduleRequest {
  userPreference: {
    energyBlocks: {
      energy: number;
      interval: Interval;
    }[];
    minGapBetweenTasks: number;
  };
  tasks: Task[];
}

export interface ScheduleResponse {
  scheduledBlocks: ScheduledBlock[];
}
