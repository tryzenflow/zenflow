import { useEffect, useState } from "react";
import { Event, ViewMode } from "@/types/schedule";
import { CalendarHeader } from "./header";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { MonthView } from "./month-view";
import { schedule } from "@/api/scheduler";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { queryEvents } from "@/api/events";
import { snapToNearestLaterQuarterHour } from "@/utils/time";

export function CalendarLayout() {
  const [date, setDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  useViewShortcuts(setViewMode);
  const [events, setEvents] = useState<Event[]>([]);

  function getDateRange() {
    switch (viewMode) {
      case "day":
        return {
          start: startOfDay(date),
          end: endOfDay(date),
        };
      case "week":
        return {
          start: startOfWeek(date),
          end: endOfWeek(date),
        };
      case "month":
        return {
          start: startOfWeek(startOfMonth(date)),
          end: endOfWeek(endOfMonth(date)),
        };
    }
  }

  async function getEvents() {
    const dateRange = getDateRange();
    try {
      const data = await queryEvents({
        start: format(dateRange.start, "yyyy-MM-dd"),
        end: format(dateRange.end, "yyyy-MM-dd"),
      });
      console.log({ data });
      setEvents(data.data);
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error(
          error.response?.data.message ||
            "An error occurred when fetching events",
        );
      }
    }
  }

  async function scheduleEvents() {
    try {
      const data = await schedule({
        keepManual: true,
        minTime: isToday(date)
          ? snapToNearestLaterQuarterHour(
              date.getHours() * 60 + date.getMinutes(),
            )
          : 0,
        scheduleDate: format(date, "yyyy-MM-dd"),
      });
      if (data.feasible) {
        await getEvents();
      } else {
        toast.error("No feasible schedule found");
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error(
          error.response?.data.message ||
            "An error occurred when scheduling events",
        );
      }
    }
  }

  useEffect(() => {
    getEvents();
  }, [date, viewMode]);

  return (
    <div
      className="flex min-h-screen flex-col rounded-lg border"
      style={
        {
          "--week-cells-height": "64px",
        } as React.CSSProperties
      }
    >
      <CalendarHeader
        currentView={viewMode}
        date={date}
        setDate={setDate}
        setCurrentView={setViewMode}
        schedule={scheduleEvents}
      />

      {viewMode === "day" && (
        <DayView events={events} date={date} setEvents={setEvents} />
      )}
      {viewMode === "week" && (
        <WeekView events={events} setEvents={setEvents} date={date} />
      )}
      {viewMode === "month" && (
        <MonthView events={events} setEvents={setEvents} date={date} />
      )}
    </div>
  );
}
