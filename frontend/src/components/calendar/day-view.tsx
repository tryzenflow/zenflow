import { Event } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { DayGrid } from "./day-grid";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";

interface DayViewProps {
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  date: Date;
  onReschedule: (taskId: string, startISO: string) => void;
}

export function DayView({ events, setEvents, date, onReschedule }: DayViewProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  function onDragEnd({ over, active }: DragEndEvent) {
    if (!over) return;
    const activeId = active.id.toString();
    const block = events.find((e) => e.id === activeId);
    if (!block) return;
    const [hours, minutes] = over.id.toString().split(":").map(Number);

    const duration =
      new Date(block.end).getTime() - new Date(block.start).getTime();
    // Drop target is a user-tz wall-clock time on the block's existing day;
    // set it in zoned space, then convert back to a real UTC instant.
    const wall = zonedDate(block.start, tz);
    wall.setHours(hours, minutes, 0, 0);
    const newStart = zonedWallClockToUtc(wall, tz);
    const newEnd = new Date(newStart.getTime() + duration);

    setEvents((evs) =>
      evs.map((ev) =>
        ev.id === activeId
          ? { ...ev, start: newStart.toISOString(), end: newEnd.toISOString() }
          : ev,
      ),
    );
    onReschedule(block.taskId, newStart.toISOString());
  }

  return (
    <DndContext modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <DayGrid events={events} date={date} />
    </DndContext>
  );
}
