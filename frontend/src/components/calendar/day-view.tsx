import { Event } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { DayGrid } from "./day-grid";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { startOfDay } from "date-fns";

interface DayViewProps {
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  date: Date;
}

export function DayView({ events, setEvents, date }: DayViewProps) {
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
    <DndContext modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <DayGrid events={events} date={date} />
    </DndContext>
  );
}
