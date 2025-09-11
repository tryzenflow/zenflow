import { Interval } from "../../constraints/interfaces/interval.interface";

export interface ScheduleRequest {
  constraints: {
    availableHours: Interval[];
    batchSimilarTasks: boolean;
    energyBlocks: {
      energyLevel: number;
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
    fixedStart?: number;
    earliestStart?: number;
    latestEnd?: number;
    deadline?: Date;
    mandatory: boolean;
    splittable: boolean;
    maxSplits: number;
    energyLevel: number;
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
