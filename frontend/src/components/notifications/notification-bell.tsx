import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Bell, Check, ChevronRight, type LucideIcon } from "lucide-react";
import { SESSION_TYPE_META } from "@zenflow/core";
import type {
  NotificationDto,
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
import { resolveSemester } from "@/utils/semester";
import {
  listNotifications,
  markNotificationActionTaken,
  markNotificationRead,
} from "@/api/notifications";
import { getSessionDetails } from "@/api/tasks";

const POLL_MS = 60_000;

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
  if (!type) return { Icon: Bell, tint: "bg-primary/15 text-primary" };
  const meta = SESSION_TYPE_META[type];
  return {
    Icon: sessionTypeIcon(type),
    tint: cn(meta.badgeClass, meta.textClass),
  };
}

/**
 * The materializer raises one `TIMETABLE` notification per ingested lecture
 * meeting, titled `"New class: <name>"` — a whole term's worth. Those fold into
 * one per-semester group; timetable *changes* ("Updated: …", "… moved at DLU")
 * keep their own row, since those are the ones a student needs to act on.
 */
function isBulkLecture(n: NotificationDto): boolean {
  return n.topic === "TIMETABLE" && n.title.startsWith("New class:");
}

interface SemesterRow {
  kind: "semester";
  key: string;
  label: string;
  /** `'YYYY-MM-DD'` the term opens — the fallback jump target. */
  startDate: string;
  count: number;
  /** Newest member — drives the "detected …" stamp. */
  newest: NotificationDto;
  unread: boolean;
  /** Session behind each member, for finding the first lecture's real date. */
  memberSessionIds: string[];
}

type Row = { kind: "item"; n: NotificationDto } | SemesterRow;

/** Collapse bulk-lecture notifications into per-semester groups, order preserved. */
function buildRows(items: NotificationDto[]): Row[] {
  const rows: Row[] = [];
  const groups = new Map<string, SemesterRow>();

  for (const n of items) {
    if (!isBulkLecture(n)) {
      rows.push({ kind: "item", n });
      continue;
    }
    const sem = resolveSemester(new Date(n.sentAt));
    let group = groups.get(sem.key);
    if (!group) {
      group = {
        kind: "semester",
        key: sem.key,
        label: sem.label,
        startDate: sem.startDate,
        count: 0,
        newest: n,
        unread: false,
        memberSessionIds: [],
      };
      groups.set(sem.key, group);
      rows.push(group);
    }
    group.count += 1;
    if (n.sessionId) group.memberSessionIds.push(n.sessionId);
    if (n.sentAt > group.newest.sentAt) group.newest = n;
    if (!n.readAt) group.unread = true;
  }

  return rows;
}

/**
 * The ingestion inbox — a header bell with an unread-count badge that opens a
 * popover list of the DLU watchers' notifications. Opening it marks the shown
 * unread rows read; a row that points at a session gets a "View session"
 * action, and a term's worth of ingested lectures collapses into one
 * per-semester group that jumps the calendar to the first lecture. Mirrors
 * mobile's `app/notifications.tsx`.
 */
export function NotificationBell() {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigating = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications({ limit: 50 });
      setItems(res.notifications);
      setUnread(res.unreadCount);
    } catch {
      // Inbox is best-effort — a failed poll just keeps the last state.
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

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

  const rows = useMemo(() => buildRows(items), [items]);

  const jumpToSession = async (n: NotificationDto) => {
    if (!n.sessionId) return;
    window.dispatchEvent(
      new CustomEvent("zenflow:open-task", { detail: n.sessionId }),
    );
    setOpen(false);
    if (!n.actionTakenAt) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id
            ? { ...x, actionTakenAt: new Date().toISOString() }
            : x,
        ),
      );
      markNotificationActionTaken(n.id).catch(() => {});
    }
  };

  // A timetable group has no single session to open — it lands the calendar on
  // the first lecture of the term. That date isn't on the notification, so the
  // member sessions are read to find the earliest `scheduledStartTime`, falling
  // back to the term-opening day from the academic calendar.
  const jumpToTermStart = async (row: SemesterRow) => {
    if (navigating.current) return;
    navigating.current = true;
    setOpen(false);
    let day = row.startDate;
    try {
      const settled = await Promise.allSettled(
        row.memberSessionIds.map((id) => getSessionDetails(id)),
      );
      const earliest = settled
        .flatMap((r) =>
          r.status === "fulfilled" && r.value.scheduledStartTime
            ? [r.value.scheduledStartTime]
            : [],
        )
        .sort()[0];
      if (earliest) day = formatInTimeZone(new Date(earliest), tz, "yyyy-MM-dd");
    } catch {
      // keep the academic-calendar fallback
    } finally {
      navigating.current = false;
    }
    window.dispatchEvent(new CustomEvent("zenflow:goto-date", { detail: day }));
  };

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
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          <span className="text-[11px] text-muted-foreground">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </span>
        </div>

        {rows.length === 0 ? (
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
          <div className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {rows.map((row) =>
              row.kind === "semester" ? (
                <SemesterGroup
                  key={row.key}
                  row={row}
                  onOpen={() => jumpToTermStart(row)}
                />
              ) : (
                <NotificationRow
                  key={row.n.id}
                  n={row.n}
                  onOpen={() => jumpToSession(row.n)}
                />
              ),
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RowShell({
  tint,
  icon: Icon,
  title,
  meta,
  hint,
  unread,
  chevron,
  onClick,
  disabled,
}: {
  tint: string;
  icon: LucideIcon;
  title: string;
  meta: string;
  hint?: string;
  unread: boolean;
  chevron: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left",
        !disabled && "hover:bg-muted",
        unread && "bg-primary/[0.04]",
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
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <span className="truncate text-[13px] font-semibold">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
          {meta}
        </span>
      </span>
      {chevron && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

function NotificationRow({
  n,
  onOpen,
}: {
  n: NotificationDto;
  onOpen: () => void;
}) {
  const { Icon, tint } = topicVisual(n.topic);
  const relative = formatDistanceToNow(new Date(n.sentAt), { addSuffix: true });
  return (
    <RowShell
      tint={tint}
      icon={Icon}
      title={n.title}
      meta={n.sessionId ? `${relative} · View session` : relative}
      hint={n.content}
      unread={!n.readAt}
      chevron={Boolean(n.sessionId)}
      onClick={onOpen}
      disabled={!n.sessionId}
    />
  );
}

function SemesterGroup({
  row,
  onOpen,
}: {
  row: SemesterRow;
  onOpen: () => void;
}) {
  const { Icon, tint } = topicVisual("TIMETABLE");
  const relative = formatDistanceToNow(new Date(row.newest.sentAt), {
    addSuffix: true,
  });
  return (
    <RowShell
      tint={tint}
      icon={Icon}
      title={`${row.label} timetable`}
      meta={`${row.count} ${row.count === 1 ? "class" : "classes"} added · ${relative}`}
      hint={`Go to the first ${row.label} class`}
      unread={row.unread}
      chevron
      onClick={onOpen}
      disabled={false}
    />
  );
}
