import { cn } from "@/lib/utils";
import { Event } from "@/types/schedule";
import { TASK_CARD_CLASSES } from "@/lib/task-card";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { format, isSameDay, isSameMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useUserStore } from "@/hooks/use-user-store";
import { DEFAULT_WORK_PREFS, getDayZones } from "@/utils/zones";
import { isZonedToday, zonedDate } from "@/utils/tz";

export function MonthCell({
  date,
  currentDate,
  events,
}: {
  date: Date;
  currentDate: Date;
  events: Event[];
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: format(date, "yyyy-MM-dd"),
  });
  const prefs = useUserStore((s) => s.user) ?? DEFAULT_WORK_PREFS;
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const outside = !isSameMonth(date, currentDate);
  const today = isZonedToday(date, tz);
  const { isWorkDay } = getDayZones(date, prefs);
  const nonWork = outside || !isWorkDay;

  return (
    <div
      ref={setNodeRef}
      data-outside-cell={outside ? "true" : undefined}
      data-today={today ? "true" : undefined}
      className={cn(
        "flex min-h-[110px] flex-col p-1.5 transition-colors",
        today ? "day-today" : nonWork ? "bg-muted" : "bg-card",
        today && "border-t-foreground border-t-2",
        isOver && "ring-brand-yellow/70 ring-1 ring-inset",
      )}
    >
      {/* Date row */}
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            "text-[10px] font-bold",
            outside
              ? "text-muted-foreground/50"
              : nonWork
                ? "text-muted-foreground"
                : "text-foreground",
          )}
        >
          {date.getDate()}
        </span>
        {today && (
          <span className="bg-foreground text-background rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide">
            Today
          </span>
        )}
      </div>

      {/* Tasks — faded on off-days, mirroring the mockup. */}
      <div
        className={cn(
          "flex-1 space-y-0.5 overflow-hidden",
          nonWork && !today && "opacity-45",
        )}
      >
        {events.slice(0, 3).map((ev) => (
          <MonthEventItem key={ev.id} ev={ev} />
        ))}

        {events.length > 3 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className="text-muted-foreground h-4 w-full justify-start px-1.5 text-[10px] font-medium"
                variant="ghost"
                size="sm"
              >
                + {events.length - 3} more
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px]">
              <h5 className="mb-2 text-sm font-medium">
                {format(date, "EEE d")}
              </h5>
              <div className="space-y-0.5">
                {events
                  .filter((ev) => isSameDay(zonedDate(ev.start, tz), date))
                  .map((ev) => (
                    <MonthEventItem key={ev.id} ev={ev} />
                  ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function MonthEventItem({ ev }: { ev: Event }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: ev.id,
  });
  const style = {
    // Outputs `translate3d(x, y, 0)`
    transform: CSS.Translate.toString(transform),
  };

  return (
    <Button
      {...attributes}
      {...listeners}
      ref={setNodeRef}
      size="sm"
      variant="ghost"
      style={style}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("zenflow:open-task", { detail: ev.id }),
        )
      }
      className={cn(
        "relative z-30 mt-0 h-auto w-full justify-start gap-x-1 rounded border border-l-2 px-1.5 py-0.5 text-[10px] font-medium",
        transform && "cursor-grabbing shadow-lg",
        ev.state === "completed" && "line-through",
        TASK_CARD_CLASSES[ev.state],
      )}
    >
      <span className="truncate">{ev.title}</span>
    </Button>
  );
}
