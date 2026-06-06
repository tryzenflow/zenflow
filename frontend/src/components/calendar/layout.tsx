import { useEffect, useMemo, useState } from "react";
import { Event, ViewMode } from "@/types/schedule";
import { CalendarHeader } from "./header";
import { useViewShortcuts } from "@/hooks/use-view-shortcuts";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { CalendarSidebar } from "./sidebar";
import { EditTaskDialog } from "../tasks/edit-task-dialog";
import { listTasks, rescheduleTask } from "@/api/tasks";
import { tasksToBlocks } from "@/utils/blocks";
import type { Task, TasksMeta } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { isSameDay } from "date-fns";

export function CalendarLayout() {
  const [date, setDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  useViewShortcuts(setViewMode);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [blocks, setBlocks] = useState<Event[]>([]);
  const [meta, setMeta] = useState<TasksMeta | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

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
    const handler = (e: Event | CustomEvent) =>
      setEditId((e as CustomEvent).detail as string);
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

  const conflicts = useMemo(
    () =>
      tasks
        .filter((t) => t.conflict)
        .map((t) => ({ id: t.id, title: t.title })),
    [tasks],
  );

  const agenda = useMemo(
    () =>
      [...blocks]
        .filter((b) => isSameDay(new Date(b.start), date))
        .sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
        ),
    [blocks, date],
  );

  return (
    <div className="flex h-screen">
      <CalendarSidebar meta={meta} agenda={agenda} conflicts={conflicts} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <CalendarHeader
          date={date}
          setDate={setDate}
          currentView={viewMode}
          setCurrentView={setViewMode}
          conflictCount={meta?.conflictCount ?? 0}
          onChanged={refetch}
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
