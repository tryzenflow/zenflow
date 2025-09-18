import { Observable } from "rxjs";
import { ScheduleRequest, ScheduleResponse } from "./interfaces";

export interface SchedulerService {
  Schedule: (request: ScheduleRequest) => Observable<ScheduleResponse>;
}
