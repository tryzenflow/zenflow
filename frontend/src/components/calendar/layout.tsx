import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Event, ViewMode } from "@/types/schedule";
import { CalendarHeader } from "./header";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { CalendarSidebar, SidebarBody } from "./sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EditTaskDialog } from "@/components/tasks/edit-task-dialog";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarCheck, Plus } from "lucide-react";
import {
  completeTask,
  listTasks,
  rescheduleTask,
  resizeTask,
} from "@/api/tasks";
import { tasksToBlocks } from "@/utils/blocks";
import type { TasksMeta, RescheduleResponse } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { useUserStore } from "@/hooks/use-user-store";
import { maybeShowRationaleToast } from "@/lib/scheduling-toasts";
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
  // Interpret the date string as midnight wall-clock in user-tz.
  const utc = fromZonedTime(dateStr + "T12:00:00", tz);
  if (!isValid(utc)) return null;
  return toZonedTime(utc, tz);
}

export function CalendarLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";

  // The cursor day is held in user-tz space (its local fields are the user's
  // wall clock), so every downstream day comparison stays in that tz.
  const [date, setDate] = useState<Date>(() => {
    const resolved = useUserStore.getState().user?.timezone || "UTC";
    return (
      parseDateParam(searchParams.get("date"), resolved) ??
      zonedNow(resolved)
    );
  });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const raw = searchParams.get("view");
    return VALID_VIEWS.includes(raw as ViewMode) ? (raw as ViewMode) : "day";
  });

  // Sync view + date back into the URL whenever they change.  Use `replace`
  // so every date navigation doesn't flood the browser history stack.
  useEffect(() => {
    setSearchParams(
      { view: viewMode, date: format(date, DATE_PARAM_FORMAT) },
      { replace: true },
    );
  }, [date, viewMode, setSearchParams]);

  useViewShortcuts(viewMode, setViewMode, setDate);

  const [blocks, setBlocks] = useState<Event[]>([]);
  const [meta, setMeta] = useState<TasksMeta | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tracks an in-flight load so mutations can wait for it before issuing a PUT
  // against a task id the server may have just deleted / re-materialized via a
  // cascade. Dragging a block whose id is no longer in the freshly-loaded list
  // is what produced the spurious "Cannot find task with id …" 404 toast.
  const inFlight = useRef<Promise<Event[]> | null>(null);

  async function refetch(): Promise<Event[]> {
    const load = (async () => {
      const data = await listTasks(viewMode, date);
      const next = tasksToBlocks(data.tasks);
      setBlocks(next);
      setMeta(data.meta);
      return next;
    })();
    inFlight.current = load;
    try {
      return await load;
    } catch (error) {
      if (isAxiosError(error))
        errorToast(error.response?.data?.message || "Failed to load tasks");
      return [];
    } finally {
      if (inFlight.current === load) inFlight.current = null;
    }
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, viewMode]);

  // Open the detail panel when a block/sidebar item requests it.
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      setEditId((e as CustomEvent).detail as string);
      setNavOpen(false); // close the mobile drawer if the tap came from it
    };
    window.addEventListener("zenflow:open-task", handler as EventListener);
    return () =>
      window.removeEventListener("zenflow:open-task", handler as EventListener);
  }, []);

  // Open the settings dialog when the sidebar footer requests it.
  useEffect(() => {
    const handler = () => {
      setSettingsOpen(true);
      setNavOpen(false); // close the mobile drawer if the tap came from it
    };
    window.addEventListener("zenflow:open-settings", handler);
    return () => window.removeEventListener("zenflow:open-settings", handler);
  }, []);

  async function onReschedule(taskId: string, startISO: string) {
    // If a load is mid-flight (e.g. the cascade after a delete), wait for it so
    // we never PUT against an id the server has already dropped. The dragged
    // block carries the latest optimistic state; the await only blocks the
    // network call, not the UI.
    if (inFlight.current) {
      const fresh = await inFlight.current;
      // The task vanished server-side (deleted, or its recurrence row was
      // re-materialized under a new id). Don't fire a 404; the refetch already
      // dropped the stale block from the grid.
      if (!fresh.some((b) => b.taskId === taskId)) return;
    }
    let response: RescheduleResponse | undefined;
    try {
      // The backend pins this task `manuallyMoved` at the dropped slot, and
      // now also auto-resolves a same-day overlap with another task inline
      // (narrow same-day repack) instead of just leaving `conflict: true`.
      response = await rescheduleTask(taskId, startISO);
      window.dispatchEvent(
        new CustomEvent("zenflow:task-updated", { detail: taskId }),
      );
      maybeShowRationaleToast(response);
      // No cascade toast here: the user just directly dragged this block and
      // watched it land, so "N other tasks moved, Undo" would be noise for a
      // displacement they caused themselves. (Cascade toast still fires for
      // create/update/delete — see cascade-toast.tsx.)
    } catch (error) {
      if (isAxiosError(error))
        errorToast(error.response?.data?.message || "Failed to reschedule");
    } finally {
      // Always reconcile with the server. Nothing defers this refetch anymore
      // (there's no cascade-toast undo callback for drag to hand it off to),
      // so skipping it here would leave any displaced tasks rendering stale
      // until an unrelated refetch.
      await refetch();
    }
  }

  async function onResize(
    taskId: string,
    startISO: string,
    durationMinutes: number,
  ) {
    // Optimistic: reflect the new size immediately so the block doesn't snap
    // back to its old height for the round-trip. refetch() reconciles after.
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
    // Same stale-id guard as onReschedule: never resize a task the server has
    // dropped while a load was in flight.
    if (inFlight.current) {
      const fresh = await inFlight.current;
      if (!fresh.some((b) => b.taskId === taskId)) return;
    }
    let response: RescheduleResponse | undefined;
    try {
      // Same as onReschedule: pins this task, and now also auto-resolves a
      // same-day overlap the resize creates inline instead of just flagging
      // `conflict: true`.
      response = await resizeTask(taskId, startISO, durationMinutes);
      window.dispatchEvent(
        new CustomEvent("zenflow:task-updated", { detail: taskId }),
      );
      maybeShowRationaleToast(response);
      // No cascade toast here: the user just directly resized this block and
      // watched it land, so "N other tasks moved, Undo" would be noise for a
      // displacement they caused themselves. (Cascade toast still fires for
      // create/update/delete — see cascade-toast.tsx.)
    } catch (error) {
      if (isAxiosError(error))
        errorToast(error.response?.data?.message || "Failed to resize");
    } finally {
      // Always reconcile with the server. Nothing defers this refetch anymore
      // (there's no cascade-toast undo callback for resize to hand it off to),
      // so skipping it here would leave any displaced tasks rendering stale
      // until an unrelated refetch.
      await refetch();
    }
  }

  // Blocks dispatch resize requests via a window event (see ScheduledBlockItem),
  // mirroring zenflow:open-task. A ref keeps the listener bound to the latest
  // closure without re-subscribing on every render.
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

  async function onComplete(taskId: string) {
    // Optimistic: flip the block to DONE so it reflects immediately; refetch()
    // reconciles after the round-trip.
    setBlocks((bs) =>
      bs.map((b) => (b.taskId === taskId ? { ...b, status: "DONE" } : b)),
    );
    try {
      await completeTask(taskId);
      toast.success("Task completed");
    } catch (error) {
      if (isAxiosError(error))
        errorToast(error.response?.data?.message || "Failed to complete task");
    } finally {
      await refetch();
    }
  }

  // Double-click/tap on a block dispatches zenflow:complete-task; bound via a
  // ref exactly like the resize listener above.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  useEffect(() => {
    const handler = (e: Event | CustomEvent) => {
      const { taskId } = (e as CustomEvent).detail;
      onCompleteRef.current(taskId);
    };
    window.addEventListener("zenflow:complete-task", handler as EventListener);
    return () =>
      window.removeEventListener(
        "zenflow:complete-task",
        handler as EventListener,
      );
  }, []);

  // The agenda mirrors the active view's window, sorted chronologically; the
  // sidebar groups by day when the window spans more than one. For day/week the
  // backend display range equals the focal window, so `blocks` is already
  // scoped. In month view the backend also returns the prev/next-month tasks the
  // grid renders at its dimmed edge cells, so we filter the agenda back to the
  // focal month (same tz-based month membership as month-cell.tsx).
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
      <CalendarSidebar meta={meta} agenda={agenda} view={viewMode} />

      {/* Mobile/tablet nav drawer — same content as the desktop rail. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-full sm:w-72 bg-sidebar p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody meta={meta} agenda={agenda} view={viewMode} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CalendarHeader
          date={date}
          setDate={setDate}
          currentView={viewMode}
          setCurrentView={setViewMode}
          conflictCount={meta?.conflictCount ?? 0}
          onChanged={refetch}
          onOpenNav={() => setNavOpen(true)}
        />
        {/* `relative` so the floating glass controls overlay the grid without
            scrolling with it. */}
        <div className="relative min-h-0 flex-1">
          {/* Jump-to-today — floating, centered, glassmorphism. Replaces the
              old header "Today" button. */}
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

          {/* Floating add-task action — opens the same CreateTaskDialog the
              header used to host. Glassmorphism, mirrors the today control. */}
          <CreateTaskDialog
            date={date}
            view={viewMode}
            onCreated={refetch}
            setDate={setDate}
            trigger={
              <Button
                size="icon-lg"
                aria-label="New task"
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
        <EditTaskDialog
          open={!!editId}
          setOpen={(o) => !o && setEditId(null)}
          taskId={editId}
          onSaved={refetch}
        />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
