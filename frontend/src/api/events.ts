import { Event, UpdateEventDto } from "@/types/schedule";
import { api } from "./base";
import { DateRangeDto } from "@/types/date";

export async function queryEvents(
  dateRangeDto: DateRangeDto,
): Promise<{ data: Event[] }> {
  const { data } = await api.get("/schedules", { params: dateRangeDto });
  return data;
}

export async function updateEvent(
  id: string,
  dto: UpdateEventDto,
): Promise<{ data: Event }> {
  const { data } = await api.patch(`/schedules/${id}`, dto);
  return data;
}

export async function deleteEvent(id: string): Promise<void> {
  await api.delete(`/schedules/${id}`);
}
