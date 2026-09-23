import { notificationCategory, NotificationDto } from "@zenflow/shared";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { eventTimeLabel, notificationVisual } from "./utils";

/**
 * The tap-to-act toast for a notification that arrives over SSE while the app
 * is open — the web counterpart of mobile's foreground push. Same chrome as an
 * inbox row: the calendar type's icon + tint on the left, the title/detail
 * stacked, and a chevron on the right. Clicking it jumps to the session;
 * sonner auto-dismisses it after its duration.
 */
export function NotificationToast({
  n,
  tz,
  onOpen,
}: {
  n: NotificationDto;
  tz: string;
  onOpen: () => void;
}) {
  const { Icon, tint } = notificationVisual(n.eventName);
  // A reminder's copy already states the start time, and it isn't an item that
  // "landed on the calendar" — no repeated time line, no attention mark.
  const isReminder = notificationCategory(n.eventName) === "REMINDER";
  const when = isReminder ? null : eventTimeLabel(n, tz);
  const navigable = Boolean(n.sessionId);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!navigable}
      className={cn(
        "glass-notice flex w-md items-center gap-3 rounded-2xl px-4 py-3.5 text-left",
        navigable && "transition hover:brightness-[0.98]",
      )}
    >
      <span
        className={cn(
          // Soft tinted disc, no outline (the tint's own border is dropped).
          "flex size-9 shrink-0 items-center justify-center rounded-full border-0!",
          tint,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-foreground">
          {n.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] font-normal text-muted-foreground">
          {n.content}
        </span>
        {when && (
          <span className="mt-0.5 block text-[12px] font-normal capitalize text-muted-foreground">
            {when}
          </span>
        )}
      </span>
      {navigable && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
