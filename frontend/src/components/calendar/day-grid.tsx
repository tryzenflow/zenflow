import { Event } from "@/types/schedule";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";
import { useMemo } from "react";
import { ScheduledBlockItem } from "./scheduled-block-item";
import { format } from "date-fns";
import { Cell } from "./day-cell";
import { DayColumnBackground } from "./day-column-background";
import { getOverlapLayout } from "@/utils/overlap";
import { useUserStore } from "@/hooks/use-user-store";
import { isZonedToday, zonedNow } from "@/utils/tz";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function minutesSinceStartOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatHour(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return format(d, "h a");
}

export function DayGrid({ events, date }: { events: Event[]; date: Date }) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const nowTop = useMemo(() => {
    const mins = minutesSinceStartOfDay(zonedNow(tz));
    return `${(mins / DAILY_HORIZON) * 100}%`;
  }, [tz]);

  const layout = getOverlapLayout(events);

  return (
    <div className="border-border grid flex-1 grid-cols-[3rem_1fr] overflow-hidden border-t sm:grid-cols-[4rem_1fr]">
      {/* time ruler */}
      <div className="bg-sidebar border-border border-r">
        {HOURS.map((hour) => (
          <div key={hour} className="relative h-[var(--week-cells-height)]">
            {hour !== 0 && (
              <span className="text-muted-foreground absolute -top-2 right-0 w-full pe-2 text-right font-mono text-[10px] font-bold sm:pe-4">
                {formatHour(hour)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* day column */}
      <div className="bg-card relative">
        <DayColumnBackground date={date} />

        {isZonedToday(date, tz) && (
          <div
            className="pointer-events-none absolute inset-x-0 z-20"
            style={{ top: nowTop }}
          >
            <div className="relative flex items-center">
              <div className="absolute -left-1 h-2 w-2 rounded-full bg-rose-500 shadow-sm" />
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
                key={`${hour}:${q * TIME_GRANULARITY}`}
                id={`${hour}:${q * TIME_GRANULARITY}`}
                quarter={q}
                hour={hour}
              />
            ))}
          </div>
        ))}

        {/* events */}
        {events.map((event) => (
          <ScheduledBlockItem
            layout={layout.get(event.id) ?? { column: 0, columns: 1, conflict: false }}
            key={event.id}
            block={event}
          />
        ))}
      </div>
    </div>
  );
}
