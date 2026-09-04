import type { WorkloadByType } from "./context-vector.types";
import type { Interval } from "../core/slot";

/** One local calendar day's scheduling load — see `loadDayLoad` in `day-load.ts`. */
export interface DayLoad {
  /** Half-open intervals a placer must schedule around. */
  occupied: Interval[];
  /** Scheduled hours + session count already on the day, per session type. */
  workloadByType: WorkloadByType;
}
