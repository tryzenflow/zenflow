import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Event, Session, UpdateScope, ViewMode } from "@zenflow/shared";
import { CalendarHeader } from "./header";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { CalendarSidebar, SidebarBody } from "./sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EditSessionDialog } from "@/components/tasks/edit-task-dialog";
import { CreateSessionDialog } from "@/components/tasks/create-task-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import {
  UpdateRecurringDialog,
  type ScopeChoice,
} from "./update-recurring-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarCheck, Plus } from "lucide-react";
import { listSessions, updateSession } from "@/api/tasks";
import { getSeriesKind, tasksToBlocks } from "@zenflow/core";
import { isAxiosError } from "axios";
import { errorToast } from "@/lib/toast";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedDate, zonedNow } from "@/utils/tz";
import { format, isSameMonth, isValid } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const VALID_VIEWS: ViewMode[] = ["day", "week", "month"];
const DATE_PARAM_FORMAT = "yyyy-MM-dd";

/**
 * Parse a `YYYY-MM-DD` string as the user's wall-clock midnight in their
 * IANA timezone, returning a Date whose local fields match the given date.
 * Returns `null` when the string is missing or invalid.
 */
function parseDateParam(dateStr: string | null, tz: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const utc = fromZonedTime(dateStr + "T12:00:00", tz);
  if (!isValid(utc)) return null;
  return toZonedTime(utc, tz);
}

export function CalendarLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  const [date, setDate] = useState<Date>(() => {
    const resolved = useUserStore.getState().user?.timezone || "UTC";
    return (
      parseDateParam(searchParams.get("date"), resolved) ?? zonedNow(resolved)
    );
  });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const raw = searchParams.get("view");
    return VALID_VIEWS.includes(raw as ViewMode) ? (raw as ViewMode) : "day";
  });

  useEffect(() => {
    setSearchParams(
      { view: viewMode, date: format(date, DATE_PARAM_FORMAT) },
      { replace: true },
    );
  }, [date, viewMode, setSearchParams]);

  useViewShortcuts(viewMode, setViewMode, setDate);

  const [blocks, setBlocks] = useState<Event[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The full session rows behind `blocks`, so drag/resize can tell whether a
  // dragged block belongs to a series and needs a scope choice.
  const sessionsById = useRef<Map<string, Session>>(new Map());
  // Tracks an in-flight load so mutations can wait for it before PATCHing a
  // session id the server may have just dropped.
  const inFlight = useRef<Promise<Event[]> | null>(null);

  // Bridge the async drop handlers to the scope-picker dialog: `requestScope`
  // opens it and resolves once the user chooses (or dismisses).
  const [scopePrompt, setScopePrompt] = useState<{
    kind: "recurring" | "task";
    resolve: (choice: ScopeChoice | null) => void;
  } | null>(null);

  function requestScope(
    kind: "recurring" | "task",
  ): Promise<ScopeChoice | null> {
    return new Promise((resolve) => setScopePrompt({ kind, resolve }));
  }

  async function refetch(): Promise<Event[]> {
    const load = (async () => {
      const data = await listSessions(viewMode, date);
      sessionsById.current = new Map(data.sessions.map((s) => [s.id, s]));
      const next = tasksToBlocks(data.sessions);
      setBlocks(next);
      return next;
    })();
    inFlight.current = load;
    try {
      return await load;
    } catch (error) {
      if (isAxiosError(error))
        errorToast(error.response?.data?.message || "Failed to load sessions");
      return [];
    } finally {
      if (inFlight.current === load) inFlight.current = null;
    }
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, viewMode]);

  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      setEditId((e as CustomEvent).detail as string);
      setNavOpen(false);
    };
    window.addEventListener("zenflow:open-task", handler as EventListener);
    return () =>
      window.removeEventListener("zenflow:open-task", handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = () => {
      setSettingsOpen(true);
      setNavOpen(false);
    };
    window.addEventListener("zenflow:open-settings", handler);
    return () => window.removeEventListener("zenflow:open-settings", handler);
  }, []);

  // Jump the calendar to a `YYYY-MM-DD` day — used by the notification inbox to
  // land on the start of an ingested term's timetable.
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      const target = parseDateParam((e as CustomEvent).detail as string, tz);
      if (!target) return;
      setDate(target);
      setNavOpen(false);
    };
    window.addEventListener("zenflow:goto-date", handler as EventListener);
    return () =>
      window.removeEventListener("zenflow:goto-date", handler as EventListener);
  }, [tz]);

  /**
   * Commit a start/duration change. When the block belongs to a series the
   * user first picks a scope in `UpdateRecurringDialog`; a one-off just writes.
   */
  async function commitMove(
    taskId: string,
    patch: { scheduledStartTime: string; durationMinutes?: number },
  ) {
    if (inFlight.current) {
      const fresh = await inFlight.current;
      if (!fresh.some((b) => b.taskId === taskId)) return;
    }

    const session = sessionsById.current.get(taskId);
    const kind = session ? getSeriesKind(session) : "none";
    let scope: UpdateScope | undefined;
    let skipConflicting: boolean | undefined;
    if (kind !== "none") {
      const choice = await requestScope(kind);
      if (!choice) {
        await refetch(); // user cancelled — snap the block back
        return;
      }
      scope = choice.scope;
      skipConflicting = choice.skipConflicting;
    }

    try {
      const res = await updateSession(taskId, {
        ...patch,
        ...(scope ? { scope, skipConflicting } : {}),
      });
      if (res.skippedSessionIds?.length) {
        errorToast(
          `${res.skippedSessionIds.length} session(s) left in place — the new slot conflicted`,
        );
      }
      window.dispatchEvent(
        new CustomEvent("zenflow:task-updated", { detail: taskId }),
      );
    } catch (error) {
      if (isAxiosError(error))
        errorToast(error.response?.data?.message || "Failed to reschedule");
    } finally {
      await refetch();
    }
  }

  async function onReschedule(taskId: string, startISO: string) {
    await commitMove(taskId, { scheduledStartTime: startISO });
  }

  async function onResize(
    taskId: string,
    startISO: string,
    durationMinutes: number,
  ) {
    // Optimistic: reflect the new size immediately; refetch() reconciles after.
    setBlocks((bs) =>
      bs.map((b) =>
        b.taskId === taskId
          ? {
              ...b,
              start: startISO,
              end: new Date(
                new Date(startISO).getTime() + durationMinutes * 60_000,
              ).toISOString(),
            }
          : b,
      ),
    );
    await commitMove(taskId, {
      scheduledStartTime: startISO,
      durationMinutes,
    });
  }

  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      const { taskId, startISO, durationMinutes } = (e as CustomEvent).detail;
      onResizeRef.current(taskId, startISO, durationMinutes);
    };
    window.addEventListener("zenflow:resize-task", handler as EventListener);
    return () =>
      window.removeEventListener(
        "zenflow:resize-task",
        handler as EventListener,
      );
  }, []);

  const agenda = useMemo(() => {
    const scoped =
      viewMode === "month"
        ? blocks.filter((b) => isSameMonth(zonedDate(b.start, tz), date))
        : blocks;
    return [...scoped].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  }, [blocks, viewMode, date, tz]);

  return (
    <div className="flex h-screen">
      <CalendarSidebar agenda={agenda} view={viewMode} />

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-full sm:w-72 bg-sidebar p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody agenda={agenda} view={viewMode} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CalendarHeader
          date={date}
          setDate={setDate}
          currentView={viewMode}
          setCurrentView={setViewMode}
          onChanged={refetch}
          onOpenNav={() => setNavOpen(true)}
        />
        <div className="relative min-h-0 flex-1">
          <Button
            variant="outline"
            size="default"
            onClick={() => setDate(zonedNow(tz))}
            className={cn(
              "absolute sm:hidden left-1/2 bottom-8 z-30 -translate-x-1/2",
              "rounded-full border-border/60 bg-background/80 backdrop-blur-sm shadow-lg",
            )}
          >
            <CalendarCheck className="size-4" />
            Today
          </Button>

          <CreateSessionDialog
            date={date}
            view={viewMode}
            onCreated={refetch}
            setDate={setDate}
            trigger={
              <Button
                size="icon-lg"
                aria-label="New session"
                className={cn(
                  "sm:hidden glass-header absolute right-4 bottom-8 z-30",
                  "size-12 rounded-full border border-primary/30 text-primary-foreground shadow-lg",
                  "hover:bg-primary hover:text-primary-foreground",
                )}
              >
                <Plus className="size-5" />
              </Button>
            }
          />

          <div
            className="h-full overflow-auto"
            style={{ "--week-cells-height": "64px" } as React.CSSProperties}
          >
            {viewMode === "day" && (
              <DayView
                events={blocks}
                date={date}
                setEvents={setBlocks}
                onReschedule={onReschedule}
              />
            )}
            {viewMode === "week" && (
              <WeekView
                events={blocks}
                date={date}
                setEvents={setBlocks}
                onReschedule={onReschedule}
              />
            )}
            {viewMode === "month" && (
              <MonthView
                events={blocks}
                date={date}
                setEvents={setBlocks}
                onReschedule={onReschedule}
              />
            )}
          </div>
        </div>
      </div>
      {editId && (
        <EditSessionDialog
          open={!!editId}
          setOpen={(o) => !o && setEditId(null)}
          taskId={editId}
          onSaved={refetch}
        />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {scopePrompt && (
        <UpdateRecurringDialog
          open
          kind={scopePrompt.kind}
          onResolve={(choice) => {
            const { resolve } = scopePrompt;
            setScopePrompt(null);
            resolve(choice);
          }}
        />
      )}
    </div>
  );
}
