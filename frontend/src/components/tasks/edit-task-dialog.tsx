import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTaskForm } from "@/hooks/use-task-form";
import { format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { postData } from "@/api";
import { useUserStore } from "@/hooks/use-user-store";
import type { Task } from "@/types/tasks";
import type { TaskEvent } from "@zenflow/shared";
import { deleteTask, EditTaskFormValues } from "@/utils/tasks";
import { TaskForm } from "./form/task-form";
import { useFilesTracker } from "@/hooks/use-files-tracker";
import { completeTask, getTaskDetails, updateTask } from "@/api/tasks";
import { Clock, Trash2 } from "lucide-react";

interface EditTaskDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  taskId: string;
  onSaved: () => void;
}

export function EditTaskDialog({
  open,
  setOpen,
  taskId,
  onSaved,
}: EditTaskDialogProps) {
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const user = useUserStore((s) => s.user);
  const { newUploadsRef } = useFilesTracker();

  useEffect(() => {
    if (!open) return;
    getTaskDetails(taskId).then((res) => {
      setTask(res.task);
      setEvents(res.events);
    });
  }, [taskId, open]);

  const form = useTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      tags: [],
      note: "",
      deadlineDate: "",
      deadlineTime: "",
      isFixed: false,
      fixedStart: 9 * 60,
      fixedEnd: 10 * 60,
    },
  });

  useEffect(() => {
    if (!task) return;
    form.reset({
      title: task.title,
      duration: task.durationMinutes,
      tags: task.tags,
      note: task.note ?? "",
      isFixed: task.fixed,
      fixedStart: task.startTime,
      fixedEnd: task.startTime + task.durationMinutes,
      deadlineDate: task.deadline
        ? format(new Date(task.deadline), "yyyy-MM-dd")
        : "",
      deadlineTime: task.deadline
        ? format(new Date(task.deadline), "HH:mm")
        : "",
    });
  }, [task, form]);

  async function onSubmit(values: EditTaskFormValues) {
    if (!user) return;
    setLoading(true);
    const deadline = values.deadlineDate
      ? fromZonedTime(
          `${values.deadlineDate}T${values.deadlineTime || "23:59"}:00`,
          user.timezone,
        ).toISOString()
      : null;
    try {
      await updateTask(taskId, {
        title: values.title,
        note: values.note || null,
        deadline,
        tags: values.tags,
      });
      onSaved();
      toast.success("Task updated 🎉");
      setOpen(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update task");
    } finally {
      setLoading(false);
    }
  }

  async function onComplete() {
    try {
      await completeTask(taskId);
      onSaved();
      toast.success("Task completed");
      setOpen(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to complete task");
    }
  }

  async function onDelete() {
    try {
      await deleteTask(taskId);
      onSaved();
      toast.success("Task deleted");
      setOpen(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete task");
    }
  }

  const handleClose = async () => {
    if (newUploadsRef.current.length > 0) {
      await postData("/files/remove", { ids: newUploadsRef.current });
    }
    form.reset();
    setOpen(false);
  };

  const isDone = task?.status === "DONE";
  const statusColor = isDone
    ? "bg-emerald-500"
    : task?.conflict
      ? "bg-amber-500"
      : task?.scheduledStartTime
        ? "bg-primary"
        : "bg-muted-foreground";

  const scheduledStart = task?.scheduledStartTime
    ? new Date(task.scheduledStartTime)
    : null;
  const scheduledEnd =
    scheduledStart && task
      ? new Date(scheduledStart.getTime() + task.durationMinutes * 60_000)
      : null;

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
        {/* Non-modal + no overlay + offset below the 56px header so the calendar
          stays navigable while editing. Outside interactions are swallowed so
          paging the date range or switching view never closes the panel. */}
        <SheetContent
          showOverlay={false}
          onInteractOutside={(e) => e.preventDefault()}
          className="inset-y-auto top-14 h-[calc(100vh-3.5rem)] w-full gap-0 p-0 sm:w-[30rem] sm:max-w-[30rem]"
        >
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
            <span className={cn("size-2 shrink-0 rounded-full", statusColor)} />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold tracking-tight">
                {task?.title || "Task detail"}
              </h2>
              {task && (
                <p className="truncate text-[11px] text-muted-foreground">
                  Created {format(new Date(task.createdAt), "MMM d")}
                  {scheduledStart &&
                    ` · Scheduled ${format(scheduledStart, "EEE HH:mm")}`}
                </p>
              )}
            </div>
          </div>

          {/* Status banner */}
          {task && (
            <div className="mx-5 mt-4 flex shrink-0 items-center justify-between rounded-md border border-border bg-muted p-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                  <Clock className="size-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs font-bold">
                    {scheduledStart && scheduledEnd
                      ? `${format(scheduledStart, "EEE MMM d, HH:mm")} – ${format(scheduledEnd, "HH:mm")}`
                      : "Not yet scheduled"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {task.durationMinutes} min ·{" "}
                    {isDone
                      ? "Completed"
                      : task.fixed
                        ? "Fixed placement"
                        : "EDF engine placed"}
                  </p>
                </div>
              </div>
              {!isDone && (
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-[10px] font-bold"
                  onClick={onComplete}
                >
                  Mark Done
                </Button>
              )}
            </div>
          )}

          <TaskForm
            form={form as any}
            onSubmit={onSubmit}
            loading={loading}
            editing
            onCancel={handleClose}
            newUploadsRef={newUploadsRef}
            initialNote={task?.note ?? undefined}
            submitLabel="Save Changes"
            bodyExtra={events.length > 0 && <TaskHistory events={events} />}
            footerExtra={
              <Button
                type="button"
                variant="outline"
                onClick={onDelete}
                className="h-8 w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete Task
              </Button>
            }
          />
        </SheetContent>
      </Sheet>
  );
}

const EVENT_LABEL: Record<TaskEvent["eventType"], string> = {
  CREATE: "Created",
  MOVE: "Moved",
  RESIZE: "Resized",
  COMPLETE: "Completed",
  ABANDON: "Abandoned",
};

const EVENT_DOT: Record<TaskEvent["eventType"], string> = {
  CREATE: "bg-muted-foreground",
  MOVE: "bg-amber-500",
  RESIZE: "bg-amber-500",
  COMPLETE: "bg-emerald-500",
  ABANDON: "bg-red-500",
};

function TaskHistory({ events }: { events: TaskEvent[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold">History</h4>
      <div className="space-y-1.5">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                EVENT_DOT[e.eventType],
              )}
            />
            <div>
              <p className="text-xs font-medium">
                {EVENT_LABEL[e.eventType]} ·{" "}
                {format(new Date(e.occurredAt), "MMM d 'at' HH:mm")}
              </p>
              {e.oldSnapshot?.scheduledStartTime &&
                e.newSnapshot?.scheduledStartTime && (
                  <p className="text-[11px] text-muted-foreground">
                    {format(
                      new Date(e.oldSnapshot.scheduledStartTime),
                      "HH:mm",
                    )}{" "}
                    →{" "}
                    {format(
                      new Date(e.newSnapshot.scheduledStartTime),
                      "HH:mm",
                    )}{" "}
                    · reward {e.rewardScore.toFixed(1)}
                  </p>
                )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
