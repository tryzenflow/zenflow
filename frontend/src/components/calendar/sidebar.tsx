import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/schedule";
import type { TaskCardState, TasksMeta, ViewMode } from "@zenflow/shared";
import { toZonedTime } from "date-fns-tz";
import { Lightbulb, LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/logo";
import { logout } from "@/api/auth";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

interface SidebarProps {
  meta: TasksMeta | null;
  agenda: Event[];
  /** Active view — drives whether the agenda is grouped by day. */
  view: ViewMode;
}

/** Group chronologically-sorted blocks into contiguous per-day buckets. */
function groupByDay(
  agenda: Event[],
  tz: string,
): { key: string; label: string; items: Event[] }[] {
  const groups: { key: string; label: string; items: Event[] }[] = [];
  for (const b of agenda) {
    const d = toZonedTime(new Date(b.start), tz);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(b);
    } else {
      groups.push({
        key,
        label: d.toLocaleDateString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        items: [b],
      });
    }
  }
  return groups;
}

/** Row treatment per state — mirrors the calendar card colours (mockup 02). */
const AGENDA_ROW: Record<TaskCardState, string> = {
  fluid: "border-border bg-card hover:bg-sidebar-accent",
  overdue:
    "border-rose-400/60 bg-rose-50/60 dark:border-rose-900/30 dark:bg-rose-950/20",
  conflict:
    "border-amber-400/50 bg-amber-50/60 dark:border-amber-900/20 dark:bg-amber-950/10",
  completed: "border-border bg-card opacity-60",
};

const AGENDA_TIME: Record<TaskCardState, string> = {
  fluid: "text-muted-foreground",
  overdue: "text-rose-600 dark:text-rose-400",
  conflict: "text-amber-600 dark:text-amber-400",
  completed: "text-muted-foreground",
};

const AGENDA_TAG: Partial<Record<TaskCardState, string>> = {
  overdue: "Overdue",
  conflict: "Conflict",
};

const AGENDA_TAG_BADGE: Partial<Record<TaskCardState, string>> = {
  overdue: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400",
  conflict: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400",
};

function AgendaItem({ block, tz }: { block: Event; tz: string }) {
  const time = toZonedTime(new Date(block.start), tz).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const tag = AGENDA_TAG[block.state];
  return (
    <button
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("zenflow:open-task", { detail: block.taskId }),
        )
      }
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
        AGENDA_ROW[block.state],
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium",
          block.state === "completed" && "text-muted-foreground line-through",
        )}
      >
        {block.title}
      </span>
      {tag && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            AGENDA_TAG_BADGE[block.state],
          )}
        >
          {tag}
        </span>
      )}
      <span
        className={cn(
          "shrink-0 font-mono text-[10px]",
          AGENDA_TIME[block.state],
        )}
      >
        {block.state === "completed" ? "Done" : time}
      </span>
    </button>
  );
}

/** Desktop rail — hidden below `lg`, where the content moves into a drawer. */
export function CalendarSidebar(props: SidebarProps) {
  return (
    <aside className="hidden w-full sm:w-72 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
      <SidebarBody {...props} />
    </aside>
  );
}

/** Footer with the signed-in user, a Settings button, and Log out. */
function SidebarFooter() {
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Sign the user out locally even if the request fails.
    } finally {
      useUserStore.getState().setUser(null);
      navigate("/login");
    }
  }

  // Settings lives in a dialog mounted once in layout.tsx; request it via a
  // window event (mirrors the zenflow:open-task pattern) so the rail and the
  // mobile drawer share a single dialog instance.
  function openSettings() {
    window.dispatchEvent(new CustomEvent("zenflow:open-settings"));
  }

  const identity = user?.name || user?.email || "Account";
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="space-y-2 border-t border-sidebar-border pt-3">
      <button
        type="button"
        onClick={openSettings}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">
            {identity}
          </span>
          {user?.name && user?.email && (
            <span className="block truncate text-[10px] text-muted-foreground">
              {user.email}
            </span>
          )}
        </span>
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <LogOut className="h-3.5 w-3.5" /> Log out
      </button>
    </div>
  );
}

/** The sidebar's inner content — reused by the desktop rail and mobile drawer. */
export function SidebarBody({ meta, agenda, view }: SidebarProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const allocated = meta?.totalAllocatedMinutes ?? 0;
  const total = meta?.totalWorkMinutes ?? 0;
  const pct =
    total > 0 ? Math.min(100, Math.round((allocated / total) * 100)) : 0;
  // Day view is a single day — keep it flat; week/month group under day headers.
  const grouped = view !== "day";
  const groups = grouped ? groupByDay(agenda, tz) : [];

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Logo className="h-9 w-9 shrink-0" />
        <span className="text-xl font-semibold tracking-tight">Zenflow</span>
      </div>

      <div className="space-y-2">
        <Label>Day Load</Label>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-orange via-brand-yellow to-brand-lime transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {Math.round(allocated / 60)}h / {Math.round(total / 60)}h allocated
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Label>Agenda</Label>
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {agenda.length === 0 && (
            <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
          )}
          {grouped
            ? groups.map((g) => (
                <div key={g.key} className="space-y-1.5">
                  <p className="px-0.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </p>
                  {g.items.map((b) => (
                    <AgendaItem key={b.id} block={b} tz={tz} />
                  ))}
                </div>
              ))
            : agenda.map((b) => <AgendaItem key={b.id} block={b} tz={tz} />)}
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          <span className="inline-flex items-center gap-1">
            <Lightbulb className="h-3 w-3" /> Tips
          </span>
        </Label>
        <ul className="space-y-1 text-[11px] leading-snug text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">Click</span> on a
            task to view its details.
          </li>
          <li>
            <span className="font-semibold text-foreground">Drag</span> a task
            to reschedule it.
          </li>
          <li>
            <span className="font-semibold text-foreground">Hold and drag</span>{" "}
            one edge of a task to resize it.
          </li>
          <li>
            <span className="font-semibold text-foreground">Double-click</span>{" "}
            to mark a task as completed.
          </li>
          <li>
            The engine auto-places your tasks; ones you{" "}
            <span className="font-semibold text-foreground">drag or resize</span>{" "}
            stay pinned where you put them.
          </li>
          <li>
            Overlapping tasks are flagged as{" "}
            <span className="font-semibold text-amber-600">conflicts</span>.
          </li>
        </ul>
      </div>

      <SidebarFooter />
    </div>
  );
}
