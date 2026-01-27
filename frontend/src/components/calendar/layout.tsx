import { useState } from "react";
import { ScheduledBlock, ViewMode } from "@/types/schedule";
import { CalendarHeader } from "./header";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { endOfDay, endOfWeek, startOfDay, startOfWeek } from "date-fns";

export function CalendarLayout() {
  const [date, setDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  useViewShortcuts(setViewMode);
  const [events, setEvents] = useState<ScheduledBlock[]>([
    {
      id: "1",
      splitIndex: 0,
      task: {
        title: "Team Meeting",
        energy: 2,
        id: "1",
        duration: 60,
        rrule: null,
      },
      start: new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        10,
        0,
      ).toISOString(),
      end: new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        11,
        0,
      ).toISOString(),
    },
    {
      id: "2",
      splitIndex: 0,
      task: {
        title: "Client Project",
        energy: 3,
        id: "2",
        duration: 240,
        rrule: null,
      },
      start: new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        10,
        30,
      ).toISOString(),
      end: new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        14,
        30,
      ).toISOString(),
    },
  ]);

  return (
    <div
      className="flex min-h-[calc(100vh-var(--header-height)-3rem)] flex-col rounded-lg border"
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
      />

      {viewMode === "day" && (
        <DayView
          events={events.filter(
            (event) =>
              event.start >= startOfDay(date).toISOString() &&
              event.end <= endOfDay(date).toISOString(),
          )}
          setEvents={setEvents}
        />
      )}
      {viewMode === "week" && (
        <WeekView
          events={events.filter(
            (event) =>
              event.start >= startOfWeek(date).toISOString() &&
              event.end <= endOfWeek(date).toISOString(),
          )}
          setEvents={setEvents}
          date={date}
        />
      )}
    </div>
  );
}
