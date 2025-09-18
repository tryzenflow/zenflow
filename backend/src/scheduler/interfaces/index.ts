import { Interval } from "../../constraints/interfaces/interval.interface";

export interface ScheduleRequest {
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

  tasks: {
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
  }[];
}

export interface ScheduleResponse {
  schedules: {
    taskId: string;
    split?: number;
    start?: number;
    end?: number;
  }[];
}
