import { eachDayOfInterval, endOfWeek, startOfWeek } from "date-fns";
import { MonthGrid } from "./month-grid";
import { Event } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";

export function MonthView({
  events,
  date,
  setEvents,
}: {
  events: Event[];
  date: Date;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
}) {
  const daysOfWeek = eachDayOfInterval({
    start: startOfWeek(new Date()),
    end: endOfWeek(new Date()),
  });
  function onDragEnd({ over, active }: DragEndEvent) {
    if (!over) return;
    const activeId = active.id.toString();
    const overDate = new Date(over.id.toString());

    setEvents((events) =>
      events.map((ev) => {
        if (ev.id !== activeId) return ev;
        const startDate = new Date(ev.start);
        const endDate = new Date(ev.end);
        startDate.setDate(overDate.getDate());
        endDate.setDate(overDate.getDate());
        startDate.setMonth(overDate.getMonth());
        endDate.setMonth(overDate.getMonth());
        startDate.setFullYear(overDate.getFullYear());
        endDate.setFullYear(overDate.getFullYear());
        return {
          ...ev,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        };
      }),
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div data-slot="month-view" className="contents">
        <div className="border-border/70 grid grid-cols-7 border-b">
          {daysOfWeek.map((day) => (
            <div
              key={day.toISOString()}
              className="text-muted-foreground/70 py-2 text-center text-sm"
            >
              {day.toLocaleDateString("en-US", { weekday: "short" })}
            </div>
          ))}
        </div>
        <DndContext onDragEnd={onDragEnd}>
          <div className="grid flex-1 auto-rows-fr">
            <MonthGrid events={events} date={date} />
          </div>
        </DndContext>
      </div>
    </div>
  );
}
