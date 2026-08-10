import { Event } from "@zenflow/shared";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { DayGrid } from "./day-grid";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useUserStore } from "@/hooks/use-user-store";
import { useDragSensors } from "@/hooks/use-drag-sensors";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@zenflow/core";
import { addDays } from "date-fns";

/** px height of one hour row — mirrors the --week-cells-height CSS variable. */
const HOUR_PX = 64;
const PX_PER_MIN = HOUR_PX / 60;

interface DayViewProps {
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  date: Date;
  onReschedule: (taskId: string, startISO: string) => void;
}

export function DayView({ events, setEvents, date, onReschedule }: DayViewProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const sensors = useDragSensors();

  function onDragEnd({ over, active, delta }: DragEndEvent) {
    const activeId = active.id.toString();
    const block = events.find((e) => e.id === activeId);
    if (!block) return;

    const duration =
      new Date(block.end).getTime() - new Date(block.start).getTime();

    let targetDay = zonedDate(block.start, tz);
    let hours: number;
    let minutes: number;

    if (over) {
      // Normal drop: cell id encodes "hour:minute"
      [hours, minutes] = over.id.toString().split(":").map(Number);
    } else {
      // Dragged past the last visible cell (bottom of column). Compute the
      // intended time from the drag delta and the block's original start.
      const blockStartMin =
        targetDay.getHours() * 60 + targetDay.getMinutes();
      const rawMin =
        blockStartMin + delta.y / PX_PER_MIN;
      const snappedMin =
        Math.round(rawMin / TIME_GRANULARITY) * TIME_GRANULARITY;

      if (snappedMin >= DAILY_HORIZON) {
        // Push into the next day: overflow minutes become the new start time.
        const overflowMin = snappedMin % DAILY_HORIZON;
        targetDay = addDays(targetDay, Math.floor(snappedMin / DAILY_HORIZON));
        hours = Math.floor(overflowMin / 60);
        minutes = overflowMin % 60;
      } else if (snappedMin < 0) {
        // Dragged above the top — clamp to 00:00.
        hours = 0;
        minutes = 0;
      } else {
        hours = Math.floor(snappedMin / 60);
        minutes = snappedMin % 60;
      }
    }

    // Drop target is a user-tz wall-clock time on the target day;
    // set it in zoned space, then convert back to a real UTC instant.
    const wall = new Date(targetDay);
    wall.setHours(hours, minutes, 0, 0);
    const newStart = zonedWallClockToUtc(wall, tz);
    const newEnd = new Date(newStart.getTime() + duration);

    // No-op drop (released on the same slot it started) — don't record a move.
    if (newStart.toISOString() === block.start) return;

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
    <DndContext
      sensors={sensors}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <DayGrid events={events} date={date} />
    </DndContext>
  );
}
