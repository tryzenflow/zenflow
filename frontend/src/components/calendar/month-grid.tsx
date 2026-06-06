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
import { WEEK_STARTS_ON } from "@/utils/constants";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate } from "@/utils/tz";

export function MonthGrid({ events, date }: { events: Event[]; date: Date }) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(date), { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(endOfMonth(date), { weekStartsOn: WEEK_STARTS_ON }),
  });

  return (
    <div className="divide-border border-border grid flex-1 auto-rows-fr grid-cols-7 divide-x divide-y border-b">
      {monthDays.map((d) => (
        <MonthCell
          key={d.toISOString()}
          currentDate={date}
          date={d}
          events={events.filter((e) => isSameDay(d, zonedDate(e.start, tz)))}
        />
      ))}
    </div>
  );
}
