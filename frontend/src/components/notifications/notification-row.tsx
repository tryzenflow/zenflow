import type { MouseEvent } from "react";
import { NotificationDto, NotificationKind } from "@zenflow/shared";
import {
  conflictCopy,
  eventTimeLabel,
  isConflictTopic,
  topicVisual,
} from "./utils";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { ChevronRight, CircleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The event-category badge. The materializer stamps every row's `kind`:
 * `NEW` (something landed on the calendar), `CHANGE` (an upstream edit to an
 * item already there) or `DROP` (an item pulled upstream).
 */
const KIND_BADGE: Record<
  NotificationKind,
  { label: string; className: string }
> = {
  NEW: {
    label: "New",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  CHANGE: {
    label: "Change",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  DROP: {
    label: "Drop",
    className: "border-border bg-muted text-muted-foreground",
  },
};

export function NotificationRow({
  n,
  tz,
  onOpen,
  onDismiss,
  onRescheduleAll,
}: {
  n: NotificationDto;
  tz: string;
  onOpen: () => void;
  onDismiss: (e: MouseEvent) => void;
  onRescheduleAll?: () => void;
}) {
  const { Icon, tint } = topicVisual(n.topic);
  const badge = KIND_BADGE[n.kind];
  const unread = !n.readAt;
  const navigable = Boolean(n.sessionId);
  const relative = formatDistanceToNow(new Date(n.sentAt), { addSuffix: true });
  const when = eventTimeLabel(n, tz);

  return (
    <div className={cn("group w-full", unread && "bg-primary/[0.04]")}>
      <div className="relative flex w-full items-stretch">
        <button
          type="button"
          onClick={onOpen}
          disabled={!navigable}
          title={n.content}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-10 text-left",
            navigable && "hover:bg-muted",
          )}
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              tint,
            )}
          >
            <Icon className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {unread && (
                <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
              )}
              <span
                className={cn(
                  "truncate text-[13px]",
                  unread ? "font-semibold" : "font-medium",
                )}
              >
                {n.title}
              </span>
            </span>
            <span
              className={cn(
                "mt-1 flex items-center gap-1.5 text-[11px]",
                unread
                  ? "font-medium text-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wide",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="shrink-0">{relative}</span>
              {when && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="truncate">{when}</span>
                </>
              )}
            </span>
          </span>
        </button>
        {/* Right-side indicator, vertically centred against the row. It's swapped
          out for the dismiss button on hover so the ✕ lands in the exact same
          spot as the alert / chevron (right-3 for a size-4 icon and right-2 for
          the size-6 button both centre 20px from the edge). */}
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 transition group-hover:opacity-0">
          {n.kind === "NEW" ? (
            <CircleAlert
              className="size-4 text-destructive"
              aria-label="Needs your attention"
            />
          ) : (
            navigable && (
              <ChevronRight className="size-4 text-muted-foreground" />
            )
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {isConflictTopic(n.topic) && (
        <div className="flex items-center gap-3 pb-3 pl-16 pr-4">
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
            {conflictCopy(n.topic)}
            {n.conflictSessionIds.length > 0 &&
              ` (${n.conflictSessionIds.length})`}
          </span>
          {onRescheduleAll && n.conflictSessionIds.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRescheduleAll}
            >
              Reschedule them all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
