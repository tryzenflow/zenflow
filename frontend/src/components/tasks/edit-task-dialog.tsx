import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSessionForm } from "@/hooks/use-task-form";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import { errorToast } from "@/lib/toast";
import { postData } from "@/api";
import { useUserStore } from "@/hooks/use-user-store";
import type { Session } from "@/types/tasks";
import { deleteSession, EditSessionFormValues } from "@/utils/tasks";
import { SessionForm } from "./form/task-form";
import { useFilesTracker } from "@/hooks/use-files-tracker";
import { getSessionDetails, updateSession } from "@/api/tasks";
import { Clock, Trash2 } from "lucide-react";

interface EditSessionDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  taskId: string;
  onSaved: () => void;
}

export function EditSessionDialog({
  open,
  setOpen,
  taskId,
  onSaved,
}: EditSessionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [task, setSession] = useState<Session | null>(null);
  const user = useUserStore((s) => s.user);
  const { newUploadsRef } = useFilesTracker();

  useEffect(() => {
    if (!open) return;
    getSessionDetails(taskId).then(setSession);
  }, [taskId, open]);

  // Refresh task details when the calendar dispatches a drag/resize update
  // for this task (e.g. user drags the block while the panel is open).
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const updatedId = (e as CustomEvent<string>).detail;
      if (updatedId === taskId) {
        getSessionDetails(taskId).then(setSession);
      }
    };
    window.addEventListener("zenflow:task-updated", handler);
    return () => window.removeEventListener("zenflow:task-updated", handler);
  }, [taskId, open]);

  const form = useSessionForm({
    defaultValues: {
      title: "",
      duration: 60,
      tags: [],
      note: "",
      deadline: "",
    },
  });

  useEffect(() => {
    if (!task) return;
    form.reset({
      title: task.title,
      duration: task.durationMinutes,
      tags: task.tags,
      note: task.note ?? "",
      deadline: task.deadline ?? "",
    });
  }, [task, form]);

  async function onSubmit(values: EditSessionFormValues) {
    if (!user) return;
    setLoading(true);
    try {
      // One generic PATCH covers the whole metadata diff — there is no
      // auto-placement engine to recompute a cascade or flag a conflict
      // anymore, so this always just writes the fields and returns.
      await updateSession(taskId, {
        title: values.title,
        note: values.note || null,
        deadline: values.deadline,
        tags: values.tags,
      });
      onSaved();
      toast.success("Session updated 🎉");
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to update task",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onComplete() {
    setLoading(true);
    try {
      await updateSession(taskId, { status: "DONE" });
      onSaved();
      toast.success("Session completed");
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to complete task",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    setLoading(true);
    try {
      // Delete only frees this task's own slot — it never cascades to
      // reposition other tasks anymore, so there's nothing left to prompt.
      await deleteSession(taskId);
      onSaved();
      toast.success("Session deleted");
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Failed to delete task",
      );
    } finally {
      setLoading(false);
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
              {task?.title || "Session detail"}
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
                  {isDone ? "Completed" : "Pending"}
                </p>
              </div>
            </div>
            {!isDone && (
              <Button
                size="sm"
                className="h-7 px-2.5 text-[10px] font-bold"
                onClick={onComplete}
                disabled={loading}
              >
                Mark Done
              </Button>
            )}
          </div>
        )}

        <SessionForm
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form={form as any}
          onSubmit={onSubmit}
          loading={loading}
          editing
          onCancel={handleClose}
          newUploadsRef={newUploadsRef}
          initialNote={task?.note ?? undefined}
          submitLabel="Save Changes"
          footerExtra={
            <Button
              type="button"
              variant="outline"
              onClick={onDelete}
              disabled={loading}
              className="h-8 w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete Session
            </Button>
          }
        />
      </SheetContent>
    </Sheet>
  );
}
