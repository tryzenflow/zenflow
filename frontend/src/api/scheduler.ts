import { ScheduleDto, ScheduleResponse } from "@/types/schedule";
import { api } from "./base";

export async function schedule(
  scheduleDto: ScheduleDto,
): Promise<ScheduleResponse> {
  const { data } = await api.post<ScheduleResponse>("/schedule", scheduleDto);
  return data;
}
