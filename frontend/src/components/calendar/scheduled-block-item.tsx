import { useUserStore } from "@/hooks/use-user-store";
import { useHighlightStore } from "@/hooks/use-highlight-store";
import { cn } from "@/lib/utils";
import { TASK_CARD_CLASSES, withOverlap } from "@zenflow/core";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { DaySegment } from "@zenflow/shared";
import { DAILY_HORIZON, TIME_GRANULARITY } from "@zenflow/core";
import type { BlockLayout } from "@zenflow/core";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";
import { CSS } from "@dnd-kit/utilities";
import { useDndMonitor, useDraggable, type DragEndEvent } from "@dnd-kit/core";
import { toZonedTime } from "date-fns-tz";
import { CornerDownRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

/** Human-readable duration, e.g. 90 → "1h 30m", 45 → "45m". */
function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Below this duration (minutes) a block is too short to carry tag pills. */
const TAGS_MIN_DURATION = 45;

// Tag pills rotate through the logo's three brand hues so a wall of tags reads
// with some variety instead of a single accent. Lime is the palest stop, so it
// gets a touch more fill to stay visible; text stays neutral for legibility.
const TAG_TINTS = [
  "border-brand-orange/40 bg-brand-orange/15",
  "border-brand-yellow/45 bg-brand-yellow/15",
  "border-brand-lime/55 bg-brand-lime/25",
];

/** Stable hue pick for a tag — same tag always lands on the same color. */
function tagTint(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_TINTS[h % TAG_TINTS.length];
}

/** Notify the layout to open the task detail panel for this block's task. */
function openSession(taskId: string) {
  window.dispatchEvent(
    new CustomEvent("zenflow:open-task", { detail: taskId }),
  );
}

/** Notify the layout to persist an edge-resize for this block's task. */
function requestResize(
  taskId: string,
  startISO: string,
  durationMinutes: number,
) {
  window.dispatchEvent(
    new CustomEvent("zenflow:resize-task", {
      detail: { taskId, startISO, durationMinutes },
    }),
  );
}

// Touch: how far a finger may drift before a press counts as a drag, not a tap.
const TAP_MOVE_TOLERANCE = 8;
// Delay before a single click opens the popover, so a double-click can cancel
// it first instead of flashing the popover open.
const SINGLE_CLICK_DELAY_MS = 220;

export function ScheduledBlockItem({
  block,
  layout,
}: {
  block: DaySegment;
  layout: BlockLayout;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const highlightSessionId = useHighlightStore((s) => s.highlightSessionId);
  const clearHighlight = useHighlightStore((s) => s.clearHighlight);
  const isHighlighted = highlightSessionId === block.taskId;

  const startMin = minutesOfDay(block.start, tz);
  // A segment ending exactly at the next midnight has minutesOfDay() === 0;
  // treat that as the full-day bottom (1440) so the block fills to the boundary.
  const rawEndMin = minutesOfDay(block.end, tz);
  const endMin = block.continues || rawEndMin === 0 ? DAILY_HORIZON : rawEndMin;
  // A task that crosses midnight renders as two segments (head + tail).
  // Head segments (continues: true) carry the real task start and support
  // drag + resize: dragging preserves the full duration; bottom-resize can
  // extend past midnight; top-resize moves the start while keeping the actual
  // task end fixed (see endResize below).
  // Tail segments (continued: true) start at the clamped day boundary (00:00),
  // so their top-edge has no meaningful on-grid meaning — they stay click-only
  // and the underlying task is editable via the detail panel.
  const isSplit = Boolean(block.continued);
  const isInteractive = !isSplit;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: block.segmentId,
      disabled: !isInteractive,
    });

  // Edge-resize: while a handle is dragged we drive the block's top/height from
  // these preview minutes; on release we persist the new start + duration.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (node: HTMLDivElement | null) => {
    nodeRef.current = node;
    setNodeRef(node);
  };

  // A drop must land instantly under the pointer — only the scheduler's own
  // moves glide (see the transition class below).
  //
  // dnd-kit clears the drag transform in the same batched update that the view's
  // optimistic start/end lands in, so one commit both snaps the block back to its
  // pre-drag `top` (transform gone) and moves `top` to the dropped slot. Left
  // armed, the transition plays that as a rewind-and-glide from where the block
  // was picked up. Suppressing it via a render-time flag doesn't work: React
  // flushes pending passive effects before it renders, so any effect that resets
  // such a flag can fire between drag-end and the drop's render. So we turn
  // transitions off on the node itself, which no React commit can undo.
  const dropped = useRef(false);
  useDndMonitor(
    useMemo(
      () => ({
        // Dispatched synchronously inside dnd-kit's batched drag-end update, so
        // this lands before React renders the drop.
        onDragEnd: ({ active }: DragEndEvent) => {
          if (active.id !== block.segmentId) return;
          dropped.current = true;
          if (nodeRef.current)
            nodeRef.current.style.transitionProperty = "none";
        },
      }),
      [block.segmentId],
    ),
  );
  // Runs in the commit phase (never deferred, unlike a passive effect), so it
  // always sees the dropped position in the DOM. Reading a layout property
  // flushes styles while transitions are still off, which re-bases the block at
  // the drop target — handing the class back afterwards then has nothing to
  // animate, and the next scheduler-driven move transitions normally.
  useLayoutEffect(() => {
    if (!dropped.current || !nodeRef.current) return;
    dropped.current = false;
    void nodeRef.current.offsetTop;
    nodeRef.current.style.transitionProperty = "";
  });

  // Scroll the block into view whenever it becomes the highlighted target.
  // Fires after the DOM update (mount or refetch) so nodeRef.current is set.
  useEffect(() => {
    if (!isHighlighted || !nodeRef.current) return;
    nodeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isHighlighted]);

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
      // Allow the end to exceed DAILY_HORIZON so the user can resize a task
      // past midnight (cross-midnight resize). The duration passed to the API
      // is `end - start`, which is valid regardless of crossing midnight.
      const end = Math.max(
        r.baseStart + TIME_GRANULARITY,
        snap(r.baseEnd + deltaMin),
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
    moved.current = true; // suppress the popover-opening click after a resize
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
    // For head segments (continues: true) the block's visible bottom is clamped
    // to DAILY_HORIZON (midnight), but the task's actual end is in the next day.
    // When the user moves the top handle the end must stay fixed, so we extend
    // next.end past DAILY_HORIZON by the tail portion (minutesOfDay(taskEnd)).
    // Bottom-resize already produces end > DAILY_HORIZON via computeResize, so
    // next.end - next.start is already correct in that case.
    const durationMinutes =
      block.continues && r.edge === "top"
        ? DAILY_HORIZON + minutesOfDay(block.taskEnd, tz) - next.start
        : next.end - next.start;
    requestResize(block.taskId, startISO, durationMinutes);
  };

  // Displayed extent: the live preview while resizing, else the real times.
  const dispStart = preview?.start ?? startMin;
  const dispEnd = preview?.end ?? endMin;
  const dispDuration = dispEnd - dispStart;

  // Phase-2 delta styling: while a resize is in flight, render the minutes being
  // added (grown) or removed (shrunk) versus the persisted extent as a distinct
  // band at the changing edge. Purely visual — driven off the existing preview
  // state, so it adds nothing to the drag/resize gesture path.
  const baseStart = startMin;
  const baseEnd = endMin;
  const deltaMinutes = preview ? dispDuration - (baseEnd - baseStart) : 0;
  const growingEdge: "top" | "bottom" | null = resizing.current?.edge ?? null;
  // Hour rows are 64px, so a block under 30 min (<32px) can't fit the stacked
  // title + time + tags layout. Short blocks render as a single compact row.
  const isCompact = dispDuration < 30;
  // Tags need vertical room; on a short block they'd crowd out the title/time.
  const showTags = dispDuration > TAGS_MIN_DURATION && block.tags.length > 0;

  // Click (no drag) opens a detail popover.
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Pointer-drift tracking so a drag/resize gesture isn't mistaken for a tap.
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  // Set once the pointer drags past tolerance (or a resize begins) so the
  // trailing click is recognised as a gesture, not a tap, and skips the popover.
  const moved = useRef(false);
  // A pending single-click popover toggle; cleared if a double-click follows.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingClick = () => {
    if (clickTimer.current !== null) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    listeners?.onPointerDown?.(e); // keep dnd-kit's drag tracking intact
    moved.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pressOrigin.current) return;
    const dx = e.clientX - pressOrigin.current.x;
    const dy = e.clientY - pressOrigin.current.y;
    if (Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE) {
      moved.current = true;
    }
  };

  const endPress = () => {
    pressOrigin.current = null;
  };

  const handleClick = () => {
    // A real drag or resize ends in a click too — only a still tap opens here.
    if (moved.current || resizing.current) return;
    // Defer the toggle so a following double-click can cancel it (otherwise the
    // popover would flash open before completing the task).
    clearPendingClick();
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setPopoverOpen((o) => !o);
    }, SINGLE_CLICK_DELAY_MS);
  };

  const state = withOverlap(block.state, layout.conflict);
  const width = 100 / layout.columns;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "group absolute z-10 px-0.5",
            // Animate position/size changes that come from data (server-confirmed
            // reschedules, other clients, scheduler re-runs) so blocks glide to
            // their new slot instead of popping there. Suppressed while the user
            // is actively dragging/resizing so direct manipulation stays 1:1 with
            // the pointer — and, for the drop itself, by the inline
            // `transitionProperty` override above.
            !preview &&
              !isDragging &&
              "transition-[top,left,width,height] duration-300 ease-out",
          )}
          ref={setRefs}
          {...attributes}
          {...listeners}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onClick={handleClick}
          title={
            isSplit
              ? "Crosses midnight · click for details"
              : "Drag to reschedule · click for details"
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
          {isInteractive && (
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
          {/* Phase-2 duration-delta indicator. A grow band (amber, +N) hugs the
          edge being dragged; a shrink reads as a dashed rose outline + −N. Only
          shown mid-resize, so it never interferes with the persisted block. */}
          {preview && deltaMinutes !== 0 && (
            <>
              {deltaMinutes > 0 && (
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-x-0.5 z-20 rounded bg-primary/15 ring-1 ring-inset ring-primary/40",
                    growingEdge === "top" ? "top-0" : "bottom-0",
                  )}
                  style={{
                    height: `${(Math.abs(deltaMinutes) / Math.max(dispDuration, 1)) * 100}%`,
                  }}
                />
              )}
              <span
                className={cn(
                  "pointer-events-none absolute right-1 z-30 rounded px-1 py-0.5 font-mono text-[9px] font-bold leading-none shadow-sm",
                  deltaMinutes > 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-rose-500 text-white",
                  growingEdge === "top" ? "top-1" : "bottom-1",
                )}
              >
                {deltaMinutes > 0 ? "+" : "−"}
                {Math.abs(deltaMinutes)}m
              </span>
            </>
          )}
          <div
            className={cn(
              "flex h-full overflow-hidden rounded border border-l-4 px-2 shadow-sm transition-shadow hover:shadow-md backdrop-blur-lg",
              // While shrinking, outline the block in rose so the removed extent
              // reads distinctly from a normal resize.
              preview && deltaMinutes < 0 && "ring-1 ring-rose-400/60",
              isInteractive
                ? "cursor-grab active:cursor-grabbing"
                : "cursor-pointer",
              isCompact ? "items-center gap-1.5" : "flex-col py-1",
              // Cross-midnight segments visually butt against the day boundary:
              // the head loses its bottom rounding, the tail its top, so the two
              // halves read as one continued block split by midnight.
              block.continues && "rounded-b-none",
              block.continued &&
                "rounded-t-none border-t-0 border-l-4 border-dashed",
              TASK_CARD_CLASSES[state],
              // Ring-glow pulse that fires once after the task is created so the
              // user's eye is drawn to where it landed on the grid.
              isHighlighted && "animate-block-highlight",
            )}
            onAnimationEnd={isHighlighted ? clearHighlight : undefined}
          >
            {isCompact ? (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  {block.continued && (
                    <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-[10px] font-semibold leading-none">
                    {block.title}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[9px] leading-none">
                  {block.continued
                    ? `ends ${fmt(block.taskEnd, tz)}`
                    : fmt(block.taskStart, tz)}
                </span>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  {block.continued && (
                    <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-xs font-semibold">
                    {block.title}
                  </span>
                </div>
                <span className="font-mono text-[10px]">
                  {block.continued
                    ? `cont. → ${fmt(block.taskEnd, tz)}`
                    : block.continues
                      ? `${fmt(block.taskStart, tz)} → next day`
                      : `${fmt(block.taskStart, tz)} – ${fmt(block.taskEnd, tz)}`}
                </span>
                {showTags && (
                  <div className="mt-0.5 flex flex-wrap gap-1 overflow-hidden">
                    {block.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[9px] font-medium",
                          tagTint(t),
                        )}
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
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="right"
        className="w-72"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 shrink-0 translate-y-1 rounded-full border-l-4",
                TASK_CARD_CLASSES[state],
              )}
              aria-hidden
            />
            <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug">
              {block.title}
            </h3>
          </div>

          <dl className="flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="text-right font-mono">
                {fmt(block.taskStart, tz)} – {fmt(block.taskEnd, tz)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="text-right font-mono">
                {fmtDuration(
                  Math.round(
                    (new Date(block.taskEnd).getTime() -
                      new Date(block.taskStart).getTime()) /
                      60_000,
                  ),
                )}
              </dd>
            </div>
          </dl>

          {state === "conflict" && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                Overlap
              </span>
            </div>
          )}

          {block.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {block.tags.map((t) => (
                <span
                  key={t}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                    tagTint(t),
                  )}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setPopoverOpen(false);
              openSession(block.id);
            }}
            className="mt-1 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            Open details
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
