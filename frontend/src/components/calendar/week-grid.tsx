import { useMemo } from "react";
import { format } from "date-fns";
import { Cell } from "./day-cell";
import { DayColumnBackground } from "./day-column-background";
import { TIME_GRANULARITY } from "@zenflow/core";
import { Event } from "@zenflow/shared";
import { ScheduledBlockItem } from "./scheduled-block-item";
import { getOverlapLayout } from "@zenflow/core";
import { eventsForDay } from "@zenflow/core";
import { useUserStore } from "@/hooks/use-user-store";
import { useNow } from "@/hooks/use-now";
import { isZonedToday, zonedDate } from "@/utils/tz";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return format(d, "h a");
}

export const WeekGrid = ({
  events,
  weekDates,
}: {
  events: Event[];
  weekDates: Date[];
}) => {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const zonedNowDate = useMemo(() => zonedDate(now, tz), [now, tz]);
  return (
    <>
      {/* Time ruler */}
      <div className="bg-sidebar border-border border-r">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="relative h-[var(--week-cells-height)]"
          >
            {hour > 0 && (
              <span className="text-muted-foreground absolute -top-2 right-0 w-full pe-2 text-right font-mono text-[10px] font-bold sm:pe-4">
                {formatHour(hour)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Day columns */}
      {weekDates.map((date, d) => {
        // Clamp/split tasks to this column; a task crossing midnight renders its
        // leftover portion as a continuation segment on the next day's column.
        const dayEvents = eventsForDay(events, date, tz);
        const layout = getOverlapLayout(dayEvents);
        return (
        <div
          key={date.toISOString()}
          className="bg-card border-border relative border-r last:border-r-0"
        >
          <DayColumnBackground />

          {isZonedToday(date, tz) && (
            <div
              className="pointer-events-none absolute right-0 left-0 z-20 transition-[top] duration-1000 ease-linear"
              style={{
                top: `${64 * zonedNowDate.getHours() + zonedNowDate.getMinutes()}px`,
              }}
            >
              <div className="relative flex items-center">
                <div className="absolute -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm" />
                <div className="absolute animate-ping -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm" />
                <div className="h-[2px] w-full bg-gradient-to-r from-rose-500 via-rose-400/50 to-transparent" />
              </div>
            </div>
          )}

          {/* droppable time cells */}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="relative h-[var(--week-cells-height)]"
            >
              {Array.from({ length: 4 }).map((_, q) => (
                <Cell
                  key={`${hour}:${q}:${d}`}
                  id={`${hour}:${q * TIME_GRANULARITY}:${d}`}
                  quarter={q}
                  hour={hour}
                />
              ))}
            </div>
          ))}

          {/* events for this day */}
          {dayEvents.map((e) => (
            <ScheduledBlockItem
              block={e}
              key={e.segmentId}
              layout={
                layout.get(e.segmentId) ?? {
                  column: 0,
                  columns: 1,
                  conflict: false,
                }
              }
            />
          ))}
        </div>
        );
      })}
    </>
  );
};
