import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Ban,
  Check,
  Move,
  Pin,
  Plus,
  Scaling,
  type LucideIcon,
} from "lucide-react";
import type { TaskEvent, TaskSnapshot } from "@zenflow/shared";

/** Human label for each event type. */
const EVENT_LABEL: Record<TaskEvent["eventType"], string> = {
  CREATE: "created this task",
  MOVE: "moved this task",
  RESIZE: "resized this task",
  KEEP: "kept the current slot",
  COMPLETE: "completed this task",
  ABANDON: "abandoned this task",
};

/** Dot color semantics — neutral / amber / emerald / red. */
const EVENT_DOT: Record<TaskEvent["eventType"], string> = {
  CREATE: "bg-muted-foreground text-background",
  MOVE: "bg-brand-yellow text-white",
  RESIZE: "bg-brand-yellow text-white",
  KEEP: "bg-lime-500 text-white",
  COMPLETE: "bg-green-500 text-white",
  ABANDON: "bg-destructive text-white",
};

const EVENT_ICON: Record<TaskEvent["eventType"], LucideIcon> = {
  CREATE: Plus,
  MOVE: Move,
  RESIZE: Scaling,
  KEEP: Pin,
  COMPLETE: Check,
  ABANDON: Ban,
};

interface Range {
  start: Date;
  end: Date;
}

/** Derive the start/end range from a snapshot, or null when unscheduled. */
function snapshotRange(snap: TaskSnapshot | null | undefined): Range | null {
  if (!snap?.scheduledStartTime) return null;
  const start = new Date(snap.scheduledStartTime);
  return {
    start,
    end: new Date(start.getTime() + snap.durationMinutes * 60_000),
  };
}

/** True when the schedule (start or duration) actually changed between snapshots. */
function scheduleChanged(e: TaskEvent): boolean {
  const oldStart = e.oldSnapshot?.scheduledStartTime ?? null;
  const newStart = e.newSnapshot.scheduledStartTime ?? null;
  const oldDur = e.oldSnapshot?.durationMinutes ?? null;
  const newDur = e.newSnapshot.durationMinutes ?? null;
  return oldStart !== newStart || oldDur !== newDur;
}

function rangeLabel(range: Range | null): string {
  if (!range) return "Not yet scheduled";
  return `${format(range.start, "HH:mm")} – ${format(range.end, "HH:mm")}`;
}

/** A single +/- diff chip in GitHub style. */
function DiffChip({ sign, range }: { sign: "-" | "+"; range: Range | null }) {
  const removed = sign === "-";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1 font-mono text-[11px] tabular-nums",
        removed
          ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      )}
    >
      <span className="select-none font-bold opacity-70">{sign}</span>
      {range ? (
        <span className="flex items-center gap-1.5">
          <span className="opacity-70">
            {format(range.start, "EEE, MMM d")}
          </span>
          <span className={cn(removed && "line-through opacity-80")}>
            {rangeLabel(range)}
          </span>
        </span>
      ) : (
        <span className="italic opacity-80">Not yet scheduled</span>
      )}
    </div>
  );
}

/** A single non-diff schedule line (for CREATE / KEEP). */
function ScheduleLine({ range }: { range: Range | null }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] tabular-nums text-muted-foreground">
      {range ? (
        <>
          <span className="opacity-70">
            {format(range.start, "EEE, MMM d")}
          </span>
          <span className="text-foreground">{rangeLabel(range)}</span>
        </>
      ) : (
        <span className="italic">Not yet scheduled</span>
      )}
    </div>
  );
}

function TimelineEvent({ event }: { event: TaskEvent }) {
  const Icon = EVENT_ICON[event.eventType];
  const oldRange = snapshotRange(event.oldSnapshot);
  const newRange = snapshotRange(event.newSnapshot);
  const changed = scheduleChanged(event);

  // MOVE/RESIZE always render the diff. CREATE and KEEP show the current
  // placement as a single line. COMPLETE/ABANDON only show a line if the
  // schedule changed at the event (rare), otherwise stay concise.
  const showDiff =
    changed &&
    (event.eventType === "MOVE" ||
      event.eventType === "RESIZE" ||
      event.oldSnapshot != null);
  const showLine = event.eventType === "CREATE" || event.eventType === "KEEP";

  return (
    <li className="relative pl-8 pb-4 last:pb-0">
      {/* Dot with glyph, centered on the connecting line (left-3 ⇒ 0.75rem). */}
      <span
        className={cn(
          "absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full ring-4 ring-background",
          EVENT_DOT[event.eventType],
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-xs font-semibold">
          {EVENT_LABEL[event.eventType]}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {format(new Date(event.occurredAt), "MMM d 'at' HH:mm")}
        </span>
      </div>

      {showDiff && (
        <div className="mt-1.5 space-y-1">
          <DiffChip sign="-" range={oldRange} />
          <DiffChip sign="+" range={newRange} />
        </div>
      )}

      {!showDiff && showLine && (
        <div className="mt-1.5">
          <ScheduleLine range={newRange} />
        </div>
      )}
    </li>
  );
}

export function TaskHistory({ events }: { events: TaskEvent[] }) {
  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-semibold">Activity</h4>
      <ol className="relative">
        {/* Continuous thread: a vertical line behind the dots. left-3 aligns
          with the center of the size-6 dots (0.75rem). */}
        <span
          aria-hidden
          className="absolute bottom-2 left-3 top-2 w-px -translate-x-1/2 bg-border"
        />
        {events
          .sort((a, b) => {
            if (b.eventType === "CREATE") return -1;
            if (a.eventType === "CREATE") return 1;
            return 0;
          })
          .map((event) => (
            <TimelineEvent key={event.id} event={event} />
          ))}
      </ol>
    </div>
  );
}
