export interface SchedulerPrefs {
  timezone: string; // IANA
}

export interface EdfTask {
  id: string;
  durationMinutes: number;
  deadline: Date | null;
  manuallyMoved: boolean;
  scheduledStartTime: Date | null;
  createdAt: Date;
  /** The task's stored conflict flag. */
  conflict: boolean;
}

export interface Placement {
  id: string;
  scheduledStartTime: Date | null;
  conflict: boolean;
  manuallyMoved: boolean;
  propensity?: number;
}
