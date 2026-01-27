import { ScheduledBlock } from "@/types/schedule";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";
import { useMemo } from "react";
import { ScheduledBlockItem } from "./scheduled-block-item";
import { format } from "date-fns";
import { Cell } from "./day-cell";
import { getOverlapSpacing } from "@/utils/overlap";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function minutesSinceStartOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatHour(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return format(d, "h a");
}

export function DayGrid({ events }: { events: ScheduledBlock[] }) {
  const nowTop = useMemo(() => {
    const mins = minutesSinceStartOfDay(new Date());
    return `${(mins / DAILY_HORIZON) * 100}%`;
  }, []);

  const spacings = getOverlapSpacing(events);

  return (
    <div className="border-border/70 grid flex-1 grid-cols-[3rem_1fr] overflow-hidden border-t sm:grid-cols-[4rem_1fr]">
      {/* hours */}
      <div>
        {HOURS.map((hour) => (
          <div key={hour} className="relative h-[var(--week-cells-height)]">
            {hour !== 0 && (
              <span className="absolute -top-3 left-0 w-16  sm:pe-4 pe-2 text-right text-xs text-muted-foreground">
                {formatHour(hour)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* grid */}
      <div className="relative">
        {/* now indicator */}
        <div
          className="pointer-events-none absolute inset-x-0 z-20"
          style={{ top: nowTop }}
        >
          <div className="relative flex items-center">
            <div className="bg-primary absolute -left-1 h-2 w-2 rounded-full" />
            <div className="bg-primary h-[2px] w-full" />
          </div>
        </div>

        {/* time cells */}
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="relative h-[var(--week-cells-height)] border-b"
          >
            {Array.from({ length: 4 }).map((_, q) => (
              <Cell
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
            spacing={spacings.get(event.id) || 0}
            key={event.id}
            block={event}
          />
        ))}
      </div>
    </div>
  );
}
