import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTaskForm } from "@/hooks/use-task-form";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorToast } from "@/lib/toast";
import { postData } from "@/api";
import { useFilesTracker } from "@/hooks/use-files-tracker";
import { useUserStore } from "@/hooks/use-user-store";
import { useHighlightStore } from "@/hooks/use-highlight-store";
import { placementQualifier, TaskFormValues } from "@/utils/tasks";
import { TaskForm } from "./form/task-form";
import { Plus } from "lucide-react";
import { createTask } from "@/api/tasks";
import { format } from "date-fns";
import { isAxiosError } from "axios";
import { zonedDate } from "@/utils/tz";
import type { ViewMode } from "@zenflow/shared";
import { maybeShowRationaleToast } from "@/lib/scheduling-toasts";

export function CreateTaskDialog({
  onCreated,
  trigger,
  setDate,
}: {
  date: Date;
  view: ViewMode;
  onCreated: () => void;
  /** Custom trigger element; falls back to the default "New task" button. */
  trigger?: React.ReactNode;
  /** Navigate the calendar cursor date — used to jump to the created task's day. */
  setDate: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const user = useUserStore((state) => state.user);
  const tz = user?.timezone || "UTC";
  const setHighlight = useHighlightStore((s) => s.setHighlight);
  // Format a UTC ISO string as a readable wall-clock time in the user's tz.
  const fmt = (iso: string) => format(zonedDate(iso, tz), "EEE MMM d, HH:mm");

  const form = useTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      tags: [],
      note: "",
      deadline: "",
    },
  });
  const note = form.watch("note");
  const { newUploadsRef, updateRemovedFileIds, removedFileIds } =
    useFilesTracker();

  useEffect(() => {
    updateRemovedFileIds(note || "", "");
  }, [note]);

  // Persist the task — the only place that calls `createTask`.
  async function finalizeCreate(values: TaskFormValues) {
    if (!user) return;
    setLoading(true);
    try {
      const response = await createTask({
        title: values.title,
        note: values.note || null,
        durationMinutes: values.duration,
        tags: values.tags,
        deadline: values.deadline,
      });

      // The pure scheduler always tries in-hours-before-deadline, then
      // outside-hours-before-deadline, then in-hours-past-deadline before
      // ever giving up — so a create now ALWAYS returns a concrete
      // placement except the rare last-resort case where no slot exists
      // anywhere in the scan horizon (`task.conflict` still true). Pre-arm
      // the highlight signal before triggering refetch so the block animates
      // into focus once it renders; skip it for the conflict case, since
      // there's nothing to highlight.
      if (!response.task.conflict) {
        setHighlight(response.task.id);
        if (response.task.scheduledStartTime) {
          setDate(zonedDate(response.task.scheduledStartTime, tz));
        }
      } else {
        toast.warning(
          `"${response.task.title}" couldn't be scheduled before its deadline`,
        );
      }
      onCreated();
      form.reset();
      setOpen(false);

      // The tiered placer always names why it put the task where it did.
      maybeShowRationaleToast({
        task: response.task,
        rationale: response.schedulingMeta.rationale,
      });

      const scheduledAt = response.task.scheduledStartTime;
      const qualifier = placementQualifier(response.task, user);
      const qualifierSuffix =
        qualifier === "pastDeadline"
          ? " — past its deadline"
          : qualifier === "outsideHours"
            ? " — outside your usual work hours"
            : "";
      toast.success(
        scheduledAt
          ? `Scheduled for ${fmt(scheduledAt)}${qualifierSuffix}`
          : "Task created successfully",
      );
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Something went wrong when creating a new task",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(values: TaskFormValues) {
    if (!user) return;
    setLoading(true);
    try {
      const removed = removedFileIds.current;
      if (removed.length > 0) await postData("/files/remove", { ids: removed });
      await finalizeCreate(values);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Something went wrong when creating a new task",
      );
      setLoading(false);
    }
  }

  const handleClose = async () => {
    setLoading(true);
    try {
      if (newUploadsRef.current.length > 0) {
        await postData("/files/remove", { ids: newUploadsRef.current });
      }
      form.reset();
      setOpen(false);
    } catch (error) {
      errorToast(
        (isAxiosError(error) && error.response?.data?.message) ||
          "Something went wrong when cancelling task creation",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="hidden sm:flex">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">New task</span>
          </Button>
        )}
      </SheetTrigger>
      {/* Non-modal + no overlay + offset below the 56px header so the view can
          still be switched (which re-scopes recurrence) while creating.
          Outside interactions are swallowed so navigating the calendar (paging
          the date range, switching view) never closes the half-filled form. */}
      <SheetContent
        showOverlay={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="inset-y-auto top-14 h-[calc(100vh-3.5rem)] w-full gap-0 p-0 sm:w-[30rem] sm:max-w-[30rem]"
      >
        <div className="flex h-14 shrink-0 items-center border-b border-border px-5">
          <h2 className="text-sm font-bold tracking-tight">New Task</h2>
        </div>
        <TaskForm
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form={form as any}
          onSubmit={onSubmit}
          newUploadsRef={newUploadsRef}
          loading={loading}
          onCancel={handleClose}
          submitLabel="Create Task"
        />
      </SheetContent>
    </Sheet>
  );
}
