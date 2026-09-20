import {
  dismissNotification,
  listNotifications,
  markNotificationActionTaken,
  markNotificationRead,
} from "@/api/notifications";
import { getSessionDetails } from "@/api/tasks";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUserStore } from "@/hooks/use-user-store";
import { errorToast } from "@/lib/toast";
import type { NotificationDto } from "@zenflow/shared";
import { Bell, Check, CircleAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { toast } from "sonner";
import { NotificationToast } from "./notification-toast";
import { NotificationRow } from "./notification-row";

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

  // The SSE effect mounts once; keep the incoming-notification toast pointed at
  // the current tz + navigation handler without reconnecting the stream on
  // every render.
  const latest = useRef({ tz, jumpToSession });

  useEffect(() => {
    latest.current = { tz, jumpToSession };
    // 1. Initialize the EventSource connection
    const eventSource = new EventSource(
      `${import.meta.env.VITE_API_URL}/notifications/stream`,
      { withCredentials: true },
    );

    // 2. Listen for generic message events
    eventSource.onmessage = (event) => {
      const newData = JSON.parse(event.data) as NotificationDto;
      setItems((newItems) => [newData, ...newItems]);
      setUnread((prevUnread) => prevUnread + 1);
      // Tap-to-act toast (bottom-right) — mirrors mobile's foreground push and
      // the `detected-items.html` mockup: the calendar type's icon + tint, then
      // tap to jump to the session it landed on.
      const { tz: currentTz, jumpToSession: jump } = latest.current;
      toast.custom(
        (id) => (
          <NotificationToast
            n={newData}
            tz={currentTz}
            onOpen={() => {
              toast.dismiss(id);
              jump(newData);
            }}
          />
        ),
        { duration: 5000 },
      );
    };

    // 4. Handle errors and connection state
    eventSource.onerror = (error) => {
      // show a user-friendly error message or handle reconnection logic here
      errorToast("Failed to receive notifications", {
        description:
          "The connection to the server was lost. Notifications may be delayed.",
      });
      console.error("SSE error:", error);
    };

    // 5. Cleanup: Close the connection when the component unmounts
    return () => {
      eventSource.close();
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
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-red-500/50 bg-red-500/10 px-2 py-1 text-[11px] font-bold leading-none text-red-700 dark:text-red-300">
                  <CircleAlert className="size-3.5" />
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
