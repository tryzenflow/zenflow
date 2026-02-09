import { Event } from "@/types/schedule";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { MonthCell } from "./month-cell";

export function MonthGrid({ events, date }: { events: Event[]; date: Date }) {
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(date)),
    end: endOfWeek(endOfMonth(date)),
  });

  return (
    <div className="grid grid-cols-7 [&amp;:last-child&gt;*]:border-b-0">
      {monthDays.map((d) => (
        <MonthCell
          currentDate={date}
          date={d}
          events={events.filter((e) => isSameDay(d, new Date(e.start)))}
        />
      ))}
    </div>
  );
}
