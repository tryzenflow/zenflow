import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DisplacedTask } from "@zenflow/shared";
import { shell } from "@/lib/scheduling-toasts";
import { zonedDate } from "@/utils/tz";

function DisplacedSummaryToast({
  displaced,
  tz,
  titleFor,
  onDismiss,
}: {
  displaced: DisplacedTask[];
  tz: string;
  titleFor?: (taskId: string) => string | undefined;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fmt = (iso: string | null) =>
    iso ? format(zonedDate(iso, tz), "EEE MMM d, HH:mm") : "left unscheduled";

  return (
    <div className="flex font-sans w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {displaced.length} other {displaced.length === 1 ? "task" : "tasks"}{" "}
          moved to make room
        </p>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
      </div>
      {expanded && (
        <ul className="flex flex-col gap-1 text-xs">
          {displaced.map((d) => (
            <li
              key={d.taskId}
              className="flex items-center justify-between gap-3"
            >
              <span className="min-w-0 truncate font-medium text-foreground">
                {titleFor?.(d.taskId) ?? "A task"}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {fmt(d.newScheduledStartTime)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="self-end text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Show a "N other tasks moved to make room" summary — shared by every cascade
 * result (create, deadline/tags-change confirm, delete gap-fill, drag/resize).
 * A {@link DisplacedTask} only carries a taskId + its new start time; pass
 * `titleFor` to resolve a human title from whatever task list the caller has
 * on hand (e.g. the calendar's currently-loaded blocks). Tasks with no
 * resolvable title fall back to "A task". No-ops when nothing moved.
 */
export function showDisplacedSummaryToast(
  displaced: DisplacedTask[],
  tz: string,
  titleFor?: (taskId: string) => string | undefined,
) {
  if (displaced.length === 0) return;
  return toast.custom(
    (toastId) =>
      shell(
        <DisplacedSummaryToast
          displaced={displaced}
          tz={tz}
          titleFor={titleFor}
          onDismiss={() => toast.dismiss(toastId)}
        />,
      ),
    { duration: 8000 },
  );
}
