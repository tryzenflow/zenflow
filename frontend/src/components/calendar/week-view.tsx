import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
} from "date-fns";
import { WeekGrid } from "./week-grid";
import { Event } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import { DEFAULT_WORK_PREFS, getDayZones } from "@/utils/zones";
import { WEEK_STARTS_ON } from "@/utils/constants";

/** Shared column template: a fixed time gutter + 7 equal day columns. */
const GRID_COLS = "grid-cols-[3rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[4rem_repeat(7,minmax(0,1fr))]";

export function WeekView({
  events,
  setEvents,
  date,
  onReschedule,
}: {
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  date: Date;
  onReschedule: (taskId: string, startISO: string) => void;
}) {
  const prefs = useUserStore((s) => s.user) ?? DEFAULT_WORK_PREFS;
  const weekDates = eachDayOfInterval({
    start: startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
  });

  function onDragEnd({ over, active }: DragEndEvent) {
    if (!over) return;
    const activeId = active.id.toString();
    const block = events.find((e) => e.id === activeId);
    if (!block) return;
    const [hours, minutes, dayIndex] = over.id.toString().split(":").map(Number);

    const duration =
      new Date(block.end).getTime() - new Date(block.start).getTime();
    const newStart = new Date(weekDates[dayIndex] ?? new Date(block.start));
    newStart.setHours(hours, minutes, 0, 0);
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
    // Below `lg`, keep a min width so the 7 columns stay legible and the
    // content area scrolls horizontally instead of crushing each day.
    <div
      data-slot="week-view"
      className="flex h-full min-w-[48rem] flex-col lg:min-w-0"
    >
      {/* Day headers — sticky, frosted, aligned to the grid below. */}
      <div
        className={cn(
          "bg-card/80 border-border sticky top-0 z-30 grid border-b backdrop-blur-md",
          GRID_COLS,
        )}
      >
        <div className="text-muted-foreground border-border flex items-center justify-center border-r py-2 text-center font-mono text-[10px] font-bold">
          {format(new Date(), "z")}
        </div>
        {weekDates.map((d) => {
          const today = isToday(d);
          const { isWorkDay } = getDayZones(d, prefs);
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "flex flex-col items-center justify-center py-2",
                today && "bg-muted",
                !today && !isWorkDay && "zone-weekend",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wide",
                  today ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {format(d, "eee")}
              </span>
              <span
                className={cn(
                  "mt-0.5 text-base font-bold leading-none",
                  !today && !isWorkDay && "text-muted-foreground",
                )}
              >
                {format(d, "d")}
              </span>
            </div>
          );
        })}
      </div>

      <DndContext modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
        <div className={cn("grid", GRID_COLS)}>
          <WeekGrid weekDates={weekDates} events={events} />
        </div>
      </DndContext>
    </div>
  );
}
