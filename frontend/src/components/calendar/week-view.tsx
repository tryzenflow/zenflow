import {
  eachDayOfInterval,
  endOfWeek,
  format,
  startOfWeek,
} from "date-fns";
import { WeekGrid } from "./week-grid";
import { Event } from "@/types/schedule";
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import { useDragSensors } from "@/hooks/use-drag-sensors";
import { DEFAULT_WORK_PREFS, getDayZones } from "@/utils/zones";
import { DAILY_HORIZON, TIME_GRANULARITY, WEEK_STARTS_ON } from "@/utils/constants";
import {
  isZonedToday,
  tzAbbrev,
  zonedDate,
  zonedWallClockToUtc,
} from "@/utils/tz";

/** px height of one hour row — mirrors the --week-cells-height CSS variable. */
const HOUR_PX = 64;
const PX_PER_MIN = HOUR_PX / 60;

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
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const sensors = useDragSensors();
  // `date` is already in user-tz space, so the week columns are too.
  const weekDates = eachDayOfInterval({
    start: startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
  });

  function onDragEnd({ over, active, delta }: DragEndEvent) {
    const activeId = active.id.toString();
    const block = events.find((e) => e.id === activeId);
    if (!block) return;

    const duration =
      new Date(block.end).getTime() - new Date(block.start).getTime();

    let hours: number;
    let minutes: number;
    let targetDay: Date;

    if (over) {
      // Normal drop: cell id encodes "hour:minute:dayIndex"
      const [h, m, dayIndex] = over.id.toString().split(":").map(Number);
      hours = h;
      minutes = m;
      targetDay = new Date(weekDates[dayIndex] ?? zonedDate(block.start, tz));
    } else {
      // Dragged past the bottom (or off a column edge): compute intended time
      // from the drag delta and the block's original start.
      const blockZoned = zonedDate(block.start, tz);
      const blockStartMin =
        blockZoned.getHours() * 60 + blockZoned.getMinutes();
      const rawMin = blockStartMin + delta.y / PX_PER_MIN;
      const snappedMin =
        Math.round(rawMin / TIME_GRANULARITY) * TIME_GRANULARITY;

      // Find which week column the block originally lived in.
      const originDayIdx = weekDates.findIndex((d) => {
        const bd = zonedDate(block.start, tz);
        return (
          d.getFullYear() === bd.getFullYear() &&
          d.getMonth() === bd.getMonth() &&
          d.getDate() === bd.getDate()
        );
      });
      const baseDayIdx = originDayIdx >= 0 ? originDayIdx : 0;

      if (snappedMin >= DAILY_HORIZON) {
        // Overflowed past midnight — advance to the next day column in the week
        // if one exists, otherwise keep the last column and clamp to 23:45.
        const extraDays = Math.floor(snappedMin / DAILY_HORIZON);
        const overflowMin = snappedMin % DAILY_HORIZON;
        const nextIdx = Math.min(baseDayIdx + extraDays, weekDates.length - 1);
        targetDay = new Date(weekDates[nextIdx]);
        if (baseDayIdx + extraDays > weekDates.length - 1) {
          // No next column — place at end of last day.
          hours = Math.floor((DAILY_HORIZON - TIME_GRANULARITY) / 60);
          minutes = (DAILY_HORIZON - TIME_GRANULARITY) % 60;
        } else {
          hours = Math.floor(overflowMin / 60);
          minutes = overflowMin % 60;
        }
      } else if (snappedMin < 0) {
        // Dragged above the top — clamp to 00:00 of the current day.
        targetDay = new Date(weekDates[baseDayIdx]);
        hours = 0;
        minutes = 0;
      } else {
        targetDay = new Date(weekDates[baseDayIdx]);
        hours = Math.floor(snappedMin / 60);
        minutes = snappedMin % 60;
      }
    }

    // Target day (user-tz) + dropped wall-clock time → real UTC instant.
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
    // Below `lg`, keep a min width so the 7 columns stay legible and the
    // content area scrolls horizontally instead of crushing each day.
    // `min-h-full` (not `h-full`) lets this box grow past the viewport with the
    // 24h grid so it spans the full scroll length — that's what gives the sticky
    // day-header row room to travel and stay pinned. With a fixed `h-full` the
    // grid would overflow this box and the header would scroll away with it.
    //
    // This is a plain block (not `flex`): in WebKit a `position: sticky` element
    // that is a direct flex child of a flex item sized by `min-h-full` can lose
    // its pin after scrolling, because the flex containing block collapses and
    // the header has nothing to stick to. Stacking both children as normal
    // block-flow boxes keeps the sticky header reliably pinned in Safari.
    <div
      data-slot="week-view"
      className="min-h-full min-w-[48rem] lg:min-w-0"
    >
      {/* Day headers — sticky, aligned to the grid below. Uses a SOLID
      `bg-card` (no translucency / `backdrop-blur`): Safari fails to repaint a
      sticky element that carries its own `backdrop-filter`, so the frosted
      header would visually vanish mid-scroll. A solid token background keeps it
      opaque and visible across browsers. */}
      <div
        className={cn(
          "bg-card border-border sticky top-0 z-30 grid border-b",
          GRID_COLS,
        )}
      >
        <div className="text-muted-foreground border-border flex items-center justify-center border-r py-2 text-center font-mono text-[10px] font-bold">
          {tzAbbrev(tz)}
        </div>
        {weekDates.map((d) => {
          const today = isZonedToday(d, tz);
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

      {/* Free 2D drag: droppable cell ids encode `hour:minute:dayIndex`, so a
      horizontal drop re-days the task while the vertical position re-times it.
      Edge-resize stays vertical-only — it's pointer-event based (clientY) and
      never enters this DndContext. */}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className={cn("grid", GRID_COLS)}>
          <WeekGrid weekDates={weekDates} events={events} />
        </div>
      </DndContext>
    </div>
  );
}
