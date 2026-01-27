import {
  eachDayOfInterval,
  endOfWeek,
  format,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { WeekGrid } from "./week-grid";
import { ScheduledBlock } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

export function WeekView({
  events,
  setEvents,
  date,
}: {
  events: ScheduledBlock[];
  setEvents: React.Dispatch<React.SetStateAction<ScheduledBlock[]>>;
  date: Date;
}) {
  const weekDates = eachDayOfInterval({
    start: startOfWeek(date),
    end: endOfWeek(date),
  });
  function onDragEnd({ over, active }: DragEndEvent) {
    if (!over) return;
    const activeId = active.id.toString();
    const [hours, minutes] = over.id.toString().split(":").map(Number);

    setEvents((events) =>
      events.map((ev) => {
        if (ev.id !== activeId) return ev;
        const startDate = new Date(ev.start);
        const endDate = new Date(ev.end);
        const duration = endDate.getTime() - startDate.getTime();
        const newStart = startOfDay(new Date(startDate.getTime()));
        newStart.setHours(hours);
        newStart.setMinutes(minutes);
        const newEnd = new Date(newStart.getTime() + duration);
        return {
          ...ev,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        };
      }),
    );
  }

  return (
    <div data-slot="week-view" className="flex h-full flex-col">
      <div className="bg-background/80 border-border/70 sticky top-0 z-30 grid grid-cols-8 border-b backdrop-blur-md">
        <div className="text-muted-foreground/70 py-2 text-center text-sm">
          <span className="max-[479px]:sr-only">{format(new Date(), "z")}</span>
        </div>
        {weekDates.map((date) => (
          <div
            key={date.toISOString()}
            data-today={
              format(date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd")
                ? "true"
                : undefined
            }
            className="data-today:text-foreground text-muted-foreground/70 py-2 text-center text-sm data-today:font-medium"
          >
            <span className="sm:hidden" aria-hidden="true">
              {format(date, "eeeee d")}
            </span>
            <span className="max-sm:hidden">{format(date, "eee d")}</span>
          </div>
        ))}
      </div>
      <DndContext modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <div className="grid flex-2 grid-cols-8 overflow-hidden">
          <WeekGrid weekDates={weekDates} events={events} />
        </div>
      </DndContext>
    </div>
  );
}
