import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import { TASK_CARD_CLASSES, withOverlap } from "@/lib/task-card";
import { Event } from "@/types/schedule";
import { DAILY_HORIZON } from "@/utils/constants";
import type { BlockLayout } from "@/utils/overlap";
import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { toZonedTime } from "date-fns-tz";
import { Lock, Repeat } from "lucide-react";
import { useRef } from "react";

function minutesOfDay(iso: string, tz: string) {
  const d = toZonedTime(new Date(iso), tz);
  return d.getHours() * 60 + d.getMinutes();
}

function fmt(iso: string, tz: string) {
  return toZonedTime(new Date(iso), tz).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Notify the layout to open the task detail panel for this block's task. */
function openTask(taskId: string) {
  window.dispatchEvent(
    new CustomEvent("zenflow:open-task", { detail: taskId }),
  );
}

// Touch long-press: how long to hold, and how far a finger may drift first.
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 8;

export function ScheduledBlockItem({
  block,
  layout,
}: {
  block: Event;
  layout: BlockLayout;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const startMin = minutesOfDay(block.start, tz);
  const endMin = minutesOfDay(block.end, tz);
  // Hour rows are 64px, so a block under 30 min (<32px) can't fit the stacked
  // title + time + tags layout. Short blocks render as a single compact row.
  const isCompact = endMin - startMin < 30;
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: block.id,
  });

  // Long-press to open on touch, without stealing the drag gesture.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    pressOrigin.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    listeners?.onPointerDown?.(e); // keep dnd-kit's drag tracking intact
    if (e.pointerType !== "touch") return;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      openTask(block.id);
      cancelLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pressOrigin.current) return;
    const dx = e.clientX - pressOrigin.current.x;
    const dy = e.clientY - pressOrigin.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
  };

  const state = withOverlap(block.state, layout.conflict);
  const width = 100 / layout.columns;

  return (
    <div
      className="absolute z-10 px-0.5"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onDoubleClick={() => openTask(block.id)}
      title="Drag to reschedule · double-click to edit"
      style={{
        top: `${(startMin / DAILY_HORIZON) * 100}%`,
        left: `${layout.column * width}%`,
        width: `${width}%`,
        height: `${((endMin - startMin) / DAILY_HORIZON) * 100}%`,
        transform: CSS.Translate.toString(transform),
      }}
    >
      <div
        className={cn(
          "flex h-full cursor-grab overflow-hidden rounded border border-l-4 px-2 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing backdrop-blur-lg",
          isCompact ? "items-center gap-1.5" : "flex-col py-1",
          TASK_CARD_CLASSES[state],
        )}
      >
        {isCompact ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {block.fixed && (
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {block.rrule && (
                <Repeat className="h-3 w-3 shrink-0 text-primary" />
              )}
              <span
                className={cn(
                  "truncate text-[10px] font-semibold leading-none",
                  state === "completed" && "line-through",
                )}
              >
                {block.title}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[9px] leading-none">
              {fmt(block.start, tz)}
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1">
              {block.fixed && (
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {block.rrule && (
                <Repeat className="h-3 w-3 shrink-0 text-primary" />
              )}
              <span
                className={cn(
                  "truncate text-xs font-semibold",
                  state === "completed" && "line-through",
                )}
              >
                {block.title}
              </span>
            </div>
            <span className="font-mono text-[10px]">
              {fmt(block.start, tz)} – {fmt(block.end, tz)}
            </span>
            {block.tags.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-1 overflow-hidden">
                {block.tags.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
