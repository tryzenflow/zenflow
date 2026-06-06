import { useEffect, useMemo, useRef, useState } from "react";
import { Event, ViewMode } from "@/types/schedule";
import { CalendarHeader } from "./header";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { CalendarSidebar, SidebarBody } from "./sidebar";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";
import { EditTaskDialog } from "../tasks/edit-task-dialog";
import { listTasks, rescheduleTask, resizeTask } from "@/api/tasks";
import { tasksToBlocks } from "@/utils/blocks";
import type { Task, TasksMeta } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedNow } from "@/utils/tz";

export function CalendarLayout() {
  // The cursor day is held in user-tz space (its local fields are the user's
  // wall clock), so every downstream day comparison stays in that tz.
  const [date, setDate] = useState<Date>(() =>
    zonedNow(useUserStore.getState().user?.timezone || "UTC"),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  useViewShortcuts(setViewMode);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [blocks, setBlocks] = useState<Event[]>([]);
  const [meta, setMeta] = useState<TasksMeta | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  async function refetch() {
    try {
      const data = await listTasks(viewMode, date);
      setTasks(data.tasks);
      setBlocks(tasksToBlocks(data.tasks));
      setMeta(data.meta);
    } catch (error) {
      if (isAxiosError(error))
        toast.error(error.response?.data?.message || "Failed to load tasks");
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

  async function onReschedule(taskId: string, startISO: string) {
    try {
      await rescheduleTask(taskId, startISO);
    } catch (error) {
      if (isAxiosError(error))
        toast.error(error.response?.data?.message || "Failed to reschedule");
    } finally {
      await refetch(); // reconcile with the server (applies cascade / reverts)
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
    try {
      await resizeTask(taskId, startISO, durationMinutes);
    } catch (error) {
      if (isAxiosError(error))
        toast.error(error.response?.data?.message || "Failed to resize");
    } finally {
      await refetch();
    }
  }

  // Blocks dispatch resize requests via a window event (see ScheduledBlockItem),
  // mirroring zenflow:open-task. A ref keeps the listener bound to the latest
  // closure without re-subscribing on every render.
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  useEffect(() => {
    const handler = (e: Event) => {
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

  // The agenda mirrors the active view's window (the backend already scopes
  // `blocks` to day/week/month), sorted chronologically; the sidebar groups by
  // day when the window spans more than one.
  const agenda = useMemo(
    () =>
      [...blocks].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      ),
    [blocks],
  );

  return (
    <div className="flex h-screen">
      <CalendarSidebar meta={meta} agenda={agenda} view={viewMode} />

      {/* Mobile/tablet nav drawer — same content as the desktop rail. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-72 bg-sidebar p-0 lg:hidden"
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
        <div
          className="flex-1 overflow-auto"
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
      {editId && (
        <EditTaskDialog
          open={!!editId}
          setOpen={(o) => !o && setEditId(null)}
          taskId={editId}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
