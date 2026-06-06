import { useUserStore } from "@/hooks/use-user-store";
import type { Event } from "@/types/schedule";
import type { TasksMeta } from "@zenflow/shared";
import { toZonedTime } from "date-fns-tz";
import { TriangleAlert } from "lucide-react";
import { Logo } from "@/components/logo";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

export function CalendarSidebar({
  meta,
  agenda,
  conflicts,
}: {
  meta: TasksMeta | null;
  agenda: Event[];
  conflicts: { id: string; title: string }[];
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const allocated = meta?.totalAllocatedMinutes ?? 0;
  const total = meta?.totalWorkMinutes ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((allocated / total) * 100)) : 0;

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4">
      <div className="flex items-center gap-2">
        <Logo className="h-9 w-9 shrink-0" />
        <span className="text-xl font-semibold tracking-tight">Zenflow</span>
      </div>

      <div className="space-y-2">
        <Label>Day Load</Label>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {Math.round(allocated / 60)}h / {Math.round(total / 60)}h allocated
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Label>Agenda</Label>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {agenda.length === 0 && (
            <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
          )}
          {agenda.map((b) => (
            <button
              key={b.id}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("zenflow:open-task", { detail: b.taskId }),
                )
              }
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-sidebar-accent"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {toZonedTime(new Date(b.start), tz).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="truncate text-xs">{b.title}</span>
            </button>
          ))}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-2">
          <Label>
            <span className="inline-flex items-center gap-1 text-amber-600">
              <TriangleAlert className="h-3 w-3" /> Conflicts ({conflicts.length})
            </span>
          </Label>
          <div className="space-y-1">
            {conflicts.map((c) => (
              <button
                key={c.id}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("zenflow:open-task", { detail: c.id }),
                  )
                }
                className="block w-full truncate rounded border-l-2 border-l-amber-500 bg-amber-50/40 px-2 py-1 text-left text-xs text-amber-950 dark:bg-amber-950/10 dark:text-amber-100"
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
