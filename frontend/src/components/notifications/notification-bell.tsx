import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { formatDistanceToNow } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { SESSION_TYPE_META } from "@zenflow/core";
import type {
  NotificationDto,
  NotificationKind,
  NotificationTopic,
  SessionType,
} from "@zenflow/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { sessionTypeIcon } from "@/components/calendar/session-type-badge";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import {
  dismissNotification,
  listNotifications,
  markNotificationActionTaken,
  markNotificationRead,
} from "@/api/notifications";
import { getSessionDetails } from "@/api/tasks";
import { errorToast } from "@/lib/toast";
import { toast } from "sonner";

/** Which session type a topic put on the calendar — `REMINDER` puts nothing. */
const TOPIC_TYPE: Record<NotificationTopic, SessionType | null> = {
  ASSIGNMENT: "ASSIGNMENT",
  EXAM: "EXAM",
  TIMETABLE: "LECTURE",
  REMINDER: null,
};

/**
 * Icon + tile tint for a topic — the calendar session block's own icon and
 * type accent (assignment teal, exam rose, lecture sky), so an inbox row reads
 * as the thing it put on the calendar. `REMINDER` has no session type, so it
 * rides the brand primary with the bell.
 */
function topicVisual(topic: NotificationTopic): {
  Icon: LucideIcon;
  tint: string;
} {
  const type = TOPIC_TYPE[topic];
  if (!type)
    return { Icon: Bell, tint: "border-primary/40 bg-primary/15 text-primary" };
  const meta = SESSION_TYPE_META[type];
  return {
    Icon: sessionTypeIcon(type),
    tint: cn("border", meta.badgeClass, meta.textClass),
  };
}

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

/**
 * The fixed "due" / "at" label for a row, off the linked session's end instant
 * (`eventEndsAt`). An assignment reads `due Jul 8`; an exam or lecture, which
 * has a clock time, reads `Jul 5, 9:00 AM`. Null for grouped rows and drops.
 */
function eventTimeLabel(n: NotificationDto, tz: string): string | null {
  if (!n.eventEndsAt) return null;
  const at = new Date(n.eventEndsAt);
  const date = formatInTimeZone(at, tz, "MMM d");
  if (n.topic === "ASSIGNMENT") return `due ${date}`;
  return `${date}, ${formatInTimeZone(at, tz, "h:mm a")}`;
}

/**
 * The ingestion inbox — a header bell with an unread-count badge that opens a
 * popover list of the DLU watchers' notifications. Opening it marks the shown
 * unread rows read; a row that points at a session opens it on the calendar, a
 * `NEW` row flags itself with a red mark, and any row can be dismissed with the
 * hover ✕ (the web counterpart of mobile's swipe). Mirrors mobile's
 * `app/notifications.tsx`.
 */
export function NotificationBell() {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigating = useRef(false);
  const openRef = useRef(false);
  // Ids dismissed this session. A poll that was already in flight when a row
  // was deleted would otherwise re-add it before its DELETE lands.
  const dismissed = useRef<Set<string>>(new Set());

  const load = useCallback(async (force = false) => {
    // Don't refetch while the popover is open (unless forced): opening it marks
    // every shown row read, which re-sorts the server page (unread-first) and
    // can push rows the user is looking at out of the `limit` window. The
    // effect below resyncs once it closes.
    if (openRef.current && !force) return;
    try {
      const res = await listNotifications({ limit: 50 });
      setItems(res.notifications.filter((n) => !dismissed.current.has(n.id)));
      setUnread(res.unreadCount);
    } catch {
      // Inbox is best-effort — a failed poll just keeps the last state.
    }
  }, []);

  // Mirror open state for `load`, and resync once the popover closes.
  useEffect(() => {
    openRef.current = open;
    if (!open) load();
  }, [open, load]);

  // Mark everything currently shown as read when the popover opens.
  useEffect(() => {
    if (!open) return;
    const stale = items.filter((n) => !n.readAt);
    if (stale.length === 0) return;
    setItems((prev) =>
      prev.map((n) =>
        n.readAt ? n : { ...n, readAt: new Date().toISOString() },
      ),
    );
    setUnread((u) => Math.max(0, u - stale.length));
    Promise.allSettled(stale.map((n) => markNotificationRead(n.id)));
  }, [open, items]);

  const jumpToSession = async (n: NotificationDto) => {
    if (!n.sessionId || navigating.current) return;
    navigating.current = true;
    try {
      // The ingested session may have been deleted since the notification was
      // raised — check before navigating so a dead notification surfaces an
      // error toast instead of opening an empty editor.
      await getSessionDetails(n.sessionId);
    } catch {
      errorToast("That item isn't on your calendar anymore.");
      navigating.current = false;
      return;
    }
    navigating.current = false;
    window.dispatchEvent(
      new CustomEvent("zenflow:open-task", { detail: n.sessionId }),
    );
    setOpen(false);
    if (!n.actionTakenAt) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, actionTakenAt: new Date().toISOString() } : x,
        ),
      );
      markNotificationActionTaken(n.id).catch(() => {});
    }
  };

  const dismiss = (n: NotificationDto, e: MouseEvent) => {
    e.stopPropagation();
    dismissed.current.add(n.id);
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.readAt) setUnread((u) => Math.max(0, u - 1));
    dismissNotification(n.id).catch(() => {
      dismissed.current.delete(n.id);
      errorToast("Couldn't dismiss that notification.");
      load(true);
    });
  };

  useEffect(() => {
    // 1. Initialize the EventSource connection
    const eventSource = new EventSource(
      `${import.meta.env.VITE_API_URL}/notifications/stream`,
      { withCredentials: true },
    );

    // 2. Listen for generic message events
    eventSource.onmessage = (event) => {
      const newData = JSON.parse(event.data);
      console.log("Received notification:", newData);
      setItems((newItems) => [newData, ...newItems]);
      setUnread((prevUnread) => prevUnread + 1);
      toast.info("New notification received!");
    };

    // 4. Handle errors and connection state
    eventSource.onerror = (error) => {
      // show a user-friendly error message or handle reconnection logic here
      errorToast(
        "Failed to receive notifications. Please check your connection. Retrying...",
      );
      console.error("SSE error:", error);
    };

    // 5. Cleanup: Close the connection when the component unmounts
    return () => {
      eventSource.close();
      console.log("SSE connection closed");
    };
  }, []); // Empty dependency array ensures this runs once on mount

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-4 text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-10 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
              <Check className="size-5" />
            </span>
            <p className="text-[13px] font-semibold">You're all caught up</p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Nothing new from your LMS or portal right now. Connect one in
              Settings to pull assignments, exams and classes onto your
              calendar.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1.5">
              <span className="text-[10.5px] text-muted-foreground">
                Click a row to open it · hover to dismiss
              </span>
              {unread > 0 && (
                <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {unread} unread
                </span>
              )}
            </div>
            <div className="max-h-[28rem] divide-y divide-border overflow-y-auto">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  tz={tz}
                  onOpen={() => jumpToSession(n)}
                  onDismiss={(e) => dismiss(n, e)}
                />
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  n,
  tz,
  onOpen,
  onDismiss,
}: {
  n: NotificationDto;
  tz: string;
  onOpen: () => void;
  onDismiss: (e: MouseEvent) => void;
}) {
  const { Icon, tint } = topicVisual(n.topic);
  const badge = KIND_BADGE[n.kind];
  const unread = !n.readAt;
  const navigable = Boolean(n.sessionId);
  const relative = formatDistanceToNow(new Date(n.sentAt), { addSuffix: true });
  const when = eventTimeLabel(n, tz);

  return (
    <div
      className={cn(
        "group relative flex w-full items-stretch",
        unread && "bg-primary/[0.04]",
      )}
    >
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
          navigable && <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
