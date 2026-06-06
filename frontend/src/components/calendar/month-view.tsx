import { eachDayOfInterval, endOfWeek, format, startOfWeek } from "date-fns";
import { MonthGrid } from "./month-grid";
import { Event } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { WEEK_STARTS_ON } from "@/utils/constants";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";

export function MonthView({
  events,
  date,
  setEvents,
  onReschedule,
}: {
  events: Event[];
  date: Date;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  onReschedule: (taskId: string, startISO: string) => void;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const weekdays = eachDayOfInterval({
    start: startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
  });

  function onDragEnd({ over, active }: DragEndEvent) {
    if (!over) return;
    const activeId = active.id.toString();
    const block = events.find((e) => e.id === activeId);
    if (!block) return;
    // Droppable id is a 'YYYY-MM-DD' user-tz day. Keep the block's wall-clock
    // time-of-day, move it to that day in zoned space, then back to UTC.
    const [y, m, d] = over.id.toString().split("-").map(Number);
    const wall = zonedDate(block.start, tz);
    wall.setFullYear(y, m - 1, d);
    const newStart = zonedWallClockToUtc(wall, tz);
    const duration =
      new Date(block.end).getTime() - new Date(block.start).getTime();
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
    <div data-slot="month-view" className="flex min-h-full flex-col">
      {/* Weekday headers — sticky, frosted, weekend muted. */}
      <div className="bg-card/80 border-border sticky top-0 z-10 grid grid-cols-7 border-b backdrop-blur-md">
        {weekdays.map((day, i) => (
          <div
            key={day.toISOString()}
            className={cn(
              "py-2 text-center text-[11px] font-bold uppercase tracking-wider",
              i >= 5 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {format(day, "eee")}
          </div>
        ))}
      </div>
      <DndContext onDragEnd={onDragEnd}>
        <MonthGrid events={events} date={date} />
      </DndContext>
    </div>
  );
}
