import { Interval } from "../../constraints/interfaces/interval.interface";

export interface Task {
  id: string;
  title: string;
  duration: number;
  priority: number;
  earliestStart?: number;
  latestEnd?: number;
  deadline?: Date;
  mandatory: boolean;
  maxSplits: number;
  focus: number;
  categoryId?: string;
  prerequisites: string[];
  schedules: Omit<TaskSchedule, "taskId">[];
}

export interface ScheduleRequest {
  scheduleBased: boolean;
  constraints: {
    availableHours: Interval[];
    batchSimilarTasks: boolean;
    focusBlocks: {
      level: number;
      interval: Interval;
    }[];
    maxDailyLoad: number;
    minGapBetweenTasks: number;
  };

  tasks: Task[];
}

export interface TaskSchedule {
  taskId: string;
  split: number;
  start?: number;
  end?: number;
}

export interface ScheduleResponse {
  schedules?: TaskSchedule[];
}
