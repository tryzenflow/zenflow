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
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { snapToNearestLaterQuarterHour } from "@/utils/time";
import { isAxiosError } from "axios";
import { DAILY_HORIZON, TIME_GRANULARITY, WEEK_STARTS_ON } from "@/utils/constants";
import { isZonedToday, zonedDate, zonedWallClockToUtc } from "@/utils/tz";
import type { CreateTaskResponse, ViewMode } from "@zenflow/shared";
import {
  handleDurationAdjustment,
  maybeShowRationaleToast,
} from "@/lib/scheduling-toasts";

const VIEW_SUBTITLE: Record<ViewMode, string> = {
  day: "EEE, MMM d",
  week: "'week of' MMM d",
  month: "MMMM yyyy",
};

/**
 * Compute the UTC ISO-8601 start and end of the currently visible view window.
 * The `date` argument carries the user-tz wall clock in its local fields (as
 * produced by {@link toZonedTime} / {@link zonedNow}). Date-fns operations on
 * those local fields give the correct start/end of the period in user-tz, which
 * {@link zonedWallClockToUtc} then converts back to a real UTC instant.
 *
 * These bounds are passed as `viewStart`/`viewEnd` in the create-task request so
 * the backend can surface an overflow when the EDF engine places the task outside
 * the visible window.
 */
function viewBounds(
  date: Date,
  view: ViewMode,
  tz: string,
): { viewStart: string; viewEnd: string } {
  let start: Date;
  let end: Date;
  switch (view) {
    case "day":
      start = startOfDay(date);
      end = endOfDay(date);
      break;
    case "week":
      start = startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
      end = endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
      break;
    case "month":
      start = startOfMonth(date);
      end = endOfMonth(date);
      break;
  }
  return {
    viewStart: zonedWallClockToUtc(start, tz).toISOString(),
    viewEnd: zonedWallClockToUtc(end, tz).toISOString(),
  };
}

/**
 * Build a human-readable label for the currently active view period.
 * Used as context in the overflow-recovery toast so the user knows which
 * specific period had no room (e.g. "the week of Jun 22–28" rather than just
 * "this week").
 */
function viewPeriodLabel(date: Date, view: ViewMode): string {
  switch (view) {
    case "day":
      return format(date, "EEE, MMM d");
    case "month":
      return format(date, "MMMM yyyy");
    case "week": {
      const start = startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
      const end = endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
      const startStr = format(start, "MMM d");
      // Omit the month on the end label when the week doesn't cross a month boundary.
      const endStr = format(
        end,
        start.getMonth() === end.getMonth() ? "d" : "MMM d",
      );
      return `the week of ${startStr}–${endStr}`;
    }
  }
}

export function CreateTaskDialog({
  date,
  view,
  onCreated,
  trigger,
}: {
  date: Date;
  view: ViewMode;
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
  // Default fixed window starts at the next quarter-hour (today) or 9 AM, lasting
  // an hour — but clamped to the day's horizon. Without the clamp, a same-day
  // create after ~23:00 snaps the end past DAILY_HORIZON, and since the fixed-time
  // fields are hidden in the default (flexible) mode their validation error is
  // invisible — silently blocking the Create button.
  const rawStart = isZonedToday(date, tz)
    ? snapToNearestLaterQuarterHour(date.getHours() * 60 + date.getMinutes())
    : 9 * 60;
  const fixedStart = Math.min(rawStart, DAILY_HORIZON - TIME_GRANULARITY);
  const fixedEnd = Math.min(fixedStart + 60, DAILY_HORIZON);
  const form = useTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      tags: [],
      note: "",
      deadlineDate: "",
      deadlineTime: "",
      isFixed: false,
      fixedStart,
      fixedEnd,
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
    viewRange: string,
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
        const res = await resolveOverflow(
          taskId,
          choice,
          choice === "nextAvailable" ? view : undefined,
        );
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
      } catch (error) {
        errorToast(
          (isAxiosError(error) && error.response?.data?.message) ||
            "Couldn't schedule the task — that slot may no longer be available.",
        );
      }
    }

    const toastId = toast.custom(
      (id) => (
        <div className="w-full rounded-[var(--radius)] border border-border bg-popover p-4 shadow-lg">
          <OverflowToast
            title={taskTitle}
            overflow={overflow}
            onChoose={resolve}
            onDismiss={() => toast.dismiss(id)}
            viewRange={viewRange}
          />
        </div>
      ),
      { duration: Infinity },
    );
  }

  async function onSubmit(values: TaskFormValues) {
    if (!user) return;
    setLoading(true);

    const removed = removedFileIds.current;
    const deadline = values.deadlineDate
      ? fromZonedTime(
          `${values.deadlineDate}T${values.deadlineTime || "23:59"}:00`,
          user.timezone,
        ).toISOString()
      : null;

    try {
      if (removed.length > 0) await postData("/files/remove", { ids: removed });
      const bounds = viewBounds(date, view, tz);
      const response = await createTask({
        title: values.title,
        note: values.note || null,
        durationMinutes: values.duration,
        tags: values.tags,
        deadline,
        fixed: values.isFixed,
        startTime: values.isFixed ? values.fixedStart : 0,
        // Always the viewed day: a fixed anchor when fixed, otherwise the
        // earliest day the flexible engine may place the task on.
        startDate: format(date, "yyyy-MM-dd"),
        // Drives the granularity of the "next available period" recovery option.
        view,
        // Tells the backend which slice of the calendar is visible so it can
        // flag an overflow even when the task is placed (but outside this window).
        viewStart: bounds.viewStart,
        viewEnd: bounds.viewEnd,
      });

      // When the task landed in the current view, pre-arm the highlight signal
      // before triggering refetch so the block animates into focus once it renders.
      if (!response.overflow) {
        setHighlight(response.task.id);
      }
      onCreated();
      form.reset();
      setOpen(false);

      // The engine couldn't fit the task in the current view period (it was
      // placed outside [viewStart, viewEnd] or left unplaced entirely): prompt
      // the user with whatever recovery options the backend surfaced, instead of
      // the usual success toast.
      if (response.overflow) {
        showOverflowToast(
          response.task.id,
          response.task.title,
          response.overflow,
          viewPeriodLabel(date, view),
        );
      } else {
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
      }
    } catch (error: any) {
      errorToast(
        error?.response?.data?.message ||
          error.message ||
          "Something went wrong when creating a new task",
      );
    } finally {
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
    } catch (error: any) {
      errorToast(
        error.message || "Something went wrong when cancelling task creation",
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
          <div>
            <h2 className="text-sm font-bold tracking-tight">New Task</h2>
            <p className="text-[11px] text-muted-foreground">
              Scheduling in {format(date, VIEW_SUBTITLE[view])}
            </p>
          </div>
        </div>
        <TaskForm
          form={form as any}
          onSubmit={onSubmit}
          newUploadsRef={newUploadsRef}
          loading={loading}
          onCancel={handleClose}
          date={date}
          submitLabel="Create Task"
        />
      </SheetContent>
    </Sheet>
  );
}
