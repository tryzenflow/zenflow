import { cn } from "@/lib/utils";
import { Event } from "@/types/schedule";
import { getEnergyStyle } from "@/utils/energy";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { format, isSameDay, isSameMonth, isToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

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

  return (
    <div
      data-outside-cell={!isSameMonth(date, currentDate) ? "true" : undefined}
      data-today={isToday(date) ? "true" : undefined}
      ref={setNodeRef}
      className="group border-border/70 data-outside-cell:bg-muted/25 data-outside-cell:text-muted-foreground/70 border-r border-b last:border-r-0"
    >
      <div
        data-grabbing={isOver ? "true" : undefined}
        className="data-dragging:bg-accent flex h-full flex-col px-0.5 py-1 sm:px-1"
      >
        <div className="group-data-today:bg-primary group-data-today:text-primary-foreground mt-1 inline-flex size-6 items-center justify-center rounded-full text-sm">
          {date.getDate()}
        </div>
        <div className="min-h-[calc((var(--event-height)+var(--event-gap))*2)] sm:min-h-[calc((var(--event-height)+var(--event-gap))*3)] lg:min-h-[calc((var(--event-height)+var(--event-gap))*4)]">
          {events.slice(0, 2).map((ev) => (
            <MonthEventItem key={ev.id} ev={ev} />
          ))}

          {events.length > 2 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  className="text-xs w-full justify-start h-4 font-light"
                  variant="ghost"
                  size="sm"
                >
                  <span>
                    + {events.length - 2} <span>more</span>
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[250px]">
                <h5 className="font-medium mb-2 text-sm">
                  {format(date, "EEE d")}
                </h5>
                {events
                  .filter((ev) => isSameDay(new Date(ev.start), date))
                  .map((ev) => (
                    <MonthEventItem key={ev.id} ev={ev} />
                  ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
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
      style={style}
      data-grabbing={transform ? "true" : undefined}
      className={cn(
        "data-dragging:cursor-grabbing relative z-30 data-dragging:shadow-lg data-past-event:line-through sm:px-2 justify-between mt-1 w-full h-4 rounded items-center text-[10px] sm:text-xs gap-x-4",
        getEnergyStyle(ev.task.energy).backgroundColor,
        getEnergyStyle(ev.task.energy).textColor,
      )}
    >
      <div className="line-clamp-1">
        <span className="font-light">
          {format(new Date(ev.start), "hh:mm")}{" "}
        </span>
        {ev.task.title}
      </div>
    </Button>
  );
}
