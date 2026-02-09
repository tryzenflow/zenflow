import { format, isToday } from "date-fns";
import { Cell } from "./day-cell";
import { TIME_GRANULARITY } from "@/utils/constants";
import { Event } from "@/types/schedule";
import { ScheduledBlockItem } from "./scheduled-block-item";
import { getOverlapSpacing } from "@/utils/overlap";

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
  const spacings = getOverlapSpacing(events);
  return (
    <>
      <div className="border-border/70 grid auto-cols-fr border-r">
        {HOURS.map((hour) => (
          <div className="border-border/70 relative min-h-[var(--week-cells-height)] border-b last:border-b-0">
            {hour > 0 && (
              <span className="bg-background text-muted-foreground/70 absolute -top-3 left-0 flex h-6 w-16 max-w-full items-center justify-end pe-2 text-[10px] sm:pe-4 sm:text-xs">
                {formatHour(hour)}
              </span>
            )}
          </div>
        ))}
      </div>
      {weekDates.map((date, d) => (
        <div className="border-border/70 relative grid auto-cols-fr border-r last:border-r-0">
          {events
            .filter((e) => new Date(e.start).getDay() === d)
            .map((e) => (
              <ScheduledBlockItem
                block={e}
                key={e.id}
                spacing={spacings.get(e.id) || 0}
              />
            ))}
          {isToday(date) && (
            <div
              className="pointer-events-none absolute right-0 left-0 z-20"
              style={{
                top: `${64 * new Date().getHours() + new Date().getMinutes()}px`,
              }}
            >
              <div className="relative flex items-center">
                <div className="bg-primary absolute -left-1 h-2 w-2 rounded-full" />
                <div className="bg-primary h-[2px] w-full" />
              </div>
            </div>
          )}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="relative h-[var(--week-cells-height)] border-b"
            >
              {Array.from({ length: 4 }).map((_, q) => (
                <Cell
                  id={`${hour}:${q * TIME_GRANULARITY}:${d}`}
                  quarter={q}
                  hour={hour}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
};
