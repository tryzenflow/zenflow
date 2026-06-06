import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import { TASK_CARD_CLASSES, withOverlap } from "@/lib/task-card";
import { Event } from "@/types/schedule";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@/utils/constants";
import type { BlockLayout } from "@/utils/overlap";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";
import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { toZonedTime } from "date-fns-tz";
import { Lock, Repeat } from "lucide-react";
import { useRef, useState } from "react";

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

/** Notify the layout to persist an edge-resize for this block's task. */
function requestResize(taskId: string, startISO: string, durationMinutes: number) {
  window.dispatchEvent(
    new CustomEvent("zenflow:resize-task", {
      detail: { taskId, startISO, durationMinutes },
    }),
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
  // Completed tasks are historical records — the scheduler only knows about
  // PENDING tasks, so dragging a done block would fail with "Cannot find task".
  // Disable the drag/resize gestures entirely; the block stays openable via click.
  const isCompleted = block.status === "DONE";
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: block.id,
    disabled: isCompleted,
  });

  // Edge-resize: while a handle is dragged we drive the block's top/height from
  // these preview minutes; on release we persist the new start + duration.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (node: HTMLDivElement | null) => {
    nodeRef.current = node;
    setNodeRef(node);
  };
  const resizing = useRef<{
    edge: "top" | "bottom";
    originY: number;
    pxPerMin: number;
    baseStart: number;
    baseEnd: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(
    null,
  );

  const computeResize = (clientY: number) => {
    const r = resizing.current!;
    const deltaMin = (clientY - r.originY) / r.pxPerMin;
    const snap = (m: number) =>
      Math.round(m / TIME_GRANULARITY) * TIME_GRANULARITY;
    if (r.edge === "bottom") {
      const end = Math.min(
        DAILY_HORIZON,
        Math.max(r.baseStart + TIME_GRANULARITY, snap(r.baseEnd + deltaMin)),
      );
      return { start: r.baseStart, end };
    }
    const start = Math.max(
      0,
      Math.min(r.baseEnd - TIME_GRANULARITY, snap(r.baseStart + deltaMin)),
    );
    return { start, end: r.baseEnd };
  };

  const beginResize = (edge: "top" | "bottom") => (e: React.PointerEvent) => {
    // Claim the gesture so dnd-kit doesn't treat it as a move-drag.
    e.stopPropagation();
    e.preventDefault();
    const dayPx =
      (nodeRef.current?.offsetParent as HTMLElement | null)?.clientHeight ?? 0;
    if (!dayPx) return;
    resizing.current = {
      edge,
      originY: e.clientY,
      pxPerMin: dayPx / DAILY_HORIZON,
      baseStart: startMin,
      baseEnd: endMin,
    };
    setPreview({ start: startMin, end: endMin });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveResize = (e: React.PointerEvent) => {
    if (!resizing.current) return;
    setPreview(computeResize(e.clientY));
  };

  const endResize = (e: React.PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    const next = computeResize(e.clientY);
    resizing.current = null;
    setPreview(null);
    if (next.start === r.baseStart && next.end === r.baseEnd) return; // no change

    // Minutes-of-day → real UTC instant on the block's existing day.
    const wall = zonedDate(block.start, tz);
    wall.setHours(Math.floor(next.start / 60), next.start % 60, 0, 0);
    const startISO = zonedWallClockToUtc(wall, tz).toISOString();
    requestResize(block.taskId, startISO, next.end - next.start);
  };

  // Displayed extent: the live preview while resizing, else the real times.
  const dispStart = preview?.start ?? startMin;
  const dispEnd = preview?.end ?? endMin;
  // Hour rows are 64px, so a block under 30 min (<32px) can't fit the stacked
  // title + time + tags layout. Short blocks render as a single compact row.
  const isCompact = dispEnd - dispStart < 30;

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
      className="group absolute z-10 px-0.5"
      ref={setRefs}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onDoubleClick={() => openTask(block.id)}
      title={
        isCompleted
          ? "Completed · double-click to edit"
          : "Drag to reschedule · double-click to edit"
      }
      style={{
        top: `${(dispStart / DAILY_HORIZON) * 100}%`,
        left: `${layout.column * width}%`,
        width: `${width}%`,
        height: `${((dispEnd - dispStart) / DAILY_HORIZON) * 100}%`,
        transform: CSS.Translate.toString(transform),
      }}
    >
      {/* Edge-resize handles — pointer-driven so they work for mouse and touch
          alike. They claim the gesture before dnd-kit's move-drag can start. */}
      {!isCompleted && (
        <>
          <div
            onPointerDown={beginResize("top")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute inset-x-0.5 top-0 z-30 flex h-2.5 touch-none cursor-ns-resize items-start justify-center"
            title="Drag to resize"
          >
            <div className="mt-0.5 h-0.5 w-6 rounded-full bg-foreground/0 transition-colors group-hover:bg-foreground/30" />
          </div>
          <div
            onPointerDown={beginResize("bottom")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute inset-x-0.5 bottom-0 z-30 flex h-2.5 touch-none cursor-ns-resize items-end justify-center"
            title="Drag to resize"
          >
            <div className="mb-0.5 h-0.5 w-6 rounded-full bg-foreground/0 transition-colors group-hover:bg-foreground/30" />
          </div>
        </>
      )}
      <div
        className={cn(
          "flex h-full overflow-hidden rounded border border-l-4 px-2 shadow-sm transition-shadow hover:shadow-md backdrop-blur-lg",
          isCompleted
            ? "cursor-pointer"
            : "cursor-grab active:cursor-grabbing",
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
