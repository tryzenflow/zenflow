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
import { TaskFormValues } from "@/utils/tasks";
import { TaskForm } from "./form/task-form";
import { Plus } from "lucide-react";
import { createTask, resolveOverflow } from "@/api/tasks";
import { OverflowToast } from "./overflow-toast";
import { showDisplacedSummaryToast } from "./displaced-summary-toast";
import { promptRescheduleCascade } from "./prompt-reschedule-cascade";
import { format } from "date-fns";
import { isAxiosError } from "axios";
import { zonedDate } from "@/utils/tz";
import type { CreateTaskResponse, ViewMode } from "@zenflow/shared";
import type { Event } from "@/types/schedule";
import {
  handleDurationAdjustment,
  maybeShowRationaleToast,
  shell,
} from "@/lib/scheduling-toasts";


export function CreateTaskDialog({
  blocks = [],
  onCreated,
  trigger,
}: {
  date: Date;
  view: ViewMode;
  /** The calendar's currently-loaded blocks — feeds displaced-task title
   * lookups for the cascade summary toast. */
  blocks?: Event[];
  onCreated: () => void;
  /** Custom trigger element; falls back to the default "New task" button. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const user = useUserStore((state) => state.user);
  const tz = user?.timezone || "UTC";
  const setHighlight = useHighlightStore((s) => s.setHighlight);
  // Format a UTC ISO string as a readable wall-clock time in the user's tz,
  // matching the pattern used by <OverflowToast> (e.g. "Mon Jun 23, 14:00").
  const fmt = (iso: string) => format(zonedDate(iso, tz), "EEE MMM d, HH:mm");
  const titleFor = (taskId: string) =>
    blocks.find((b) => b.taskId === taskId)?.title;

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

  // Render a persistent, custom toast offering the overflow recovery options.
  // Sonner's single `action` slot can't hold two buttons, so we hand it a
  // component and drive resolution from the button callbacks.
  function showOverflowToast(
    taskId: string,
    taskTitle: string,
    overflow: NonNullable<CreateTaskResponse["overflow"]>,
  ) {
    // Backend offered the overflow envelope but neither concrete slot exists:
    // nothing actionable, so just inform the user.
    if (!overflow.outsideHours && !overflow.nextAvailable) {
      errorToast(
        "Couldn't find any slot for this task — try a longer deadline or shorter duration.",
      );
      return;
    }

    async function resolve(choice: "outsideHours" | "nextAvailable") {
      toast.dismiss(toastId);
      try {
        const res = await resolveOverflow(taskId, choice);
        // Highlight the resolved block so the user's eye is drawn to it.
        // Set before onCreated() so the signal is ready when refetch completes.
        setHighlight(res.task.id);
        onCreated();
        // Phase-2: a resolved overflow may also land in a preference-favoured
        // slot; surface the rationale alongside the success confirmation.
        maybeShowRationaleToast(res);
        const resolvedAt = res.task.scheduledStartTime;
        toast.success(
          resolvedAt ? `Scheduled for ${fmt(resolvedAt)}` : "Task scheduled",
        );
        showDisplacedSummaryToast(res.displaced, tz, titleFor);
      } catch (error) {
        errorToast(
          (isAxiosError(error) && error.response?.data?.message) ||
            "Couldn't schedule the task — that slot may no longer be available.",
        );
      }
    }

    const toastId = toast.custom(
      (id) =>
        shell(
          <OverflowToast
            title={taskTitle}
            overflow={overflow}
            onChoose={resolve}
            onDismiss={() => toast.dismiss(id)}
          />,
        ),
      { duration: Infinity },
    );
  }

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

      // When the task landed successfully, pre-arm the highlight signal before
      // triggering refetch so the block animates into focus once it renders.
      if (!response.overflow) {
        setHighlight(response.task.id);
      }
      onCreated();
      form.reset();
      setOpen(false);

      // The engine couldn't place the task without displacing anything (a
      // create is solo-placed now — see tasks.service.ts's `create()` — so it
      // never silently bumps another task). Offer the same confirm-before-
      // reschedule prompt edit/delete use — its window is [now, deadline],
      // the task's own full feasible range, since there's no existing
      // placement to anchor a fixed band around. Declining falls back to
      // today's overflow-recovery options (place the new task elsewhere
      // instead of moving others).
      if (response.overflow) {
        const overflow = response.overflow;
        promptRescheduleCascade({
          window: {
            windowStart: new Date().toISOString(),
            windowEnd: response.task.deadline!,
          },
          title: `No room for ${response.task.title}`,
          description:
            "There's no free slot before its deadline. Reschedule other tasks to fit it in?",
          manualDescription:
            "There's no free slot before its deadline. Some tasks in this window were moved manually — how should they be handled?",
          blocks,
          tz,
          titleFor,
          onDone: onCreated,
          onDecline: () =>
            showOverflowToast(response.task.id, response.task.title, overflow),
        });
        return;
      }

      // Phase-2: when the per-tag corrector adjusted the duration, the
      // auto/ask/never UX (ADR Sequence 1) replaces the plain success toast.
      // `never`/no-adjustment falls through to the timed confirmation below.
      const handled = handleDurationAdjustment(
        response.task,
        response.schedulingMeta,
        onCreated,
      );
      if (!handled) {
        const scheduledAt = response.task.scheduledStartTime;
        toast.success(
          scheduledAt
            ? `Scheduled for ${fmt(scheduledAt)}`
            : "Task created successfully",
        );
      }
      showDisplacedSummaryToast(response.displaced, tz, titleFor);
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
