import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTaskForm } from "@/hooks/use-task-form";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { postData } from "../../api";
import { useFilesTracker } from "../../hooks/use-files-tracker";
import { useUserStore } from "../../hooks/use-user-store";
import { generateRRule, parseTags, TaskFormValues } from "../../utils/tasks";
import { TaskForm } from "./form/task-form";
import { Plus } from "lucide-react";
import { createTask } from "@/api/tasks";
import { format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { snapToNearestLaterQuarterHour } from "@/utils/time";
import { isZonedToday } from "@/utils/tz";
import type { ViewMode } from "@zenflow/shared";

const VIEW_SUBTITLE: Record<ViewMode, string> = {
  day: "EEE, MMM d",
  week: "'week of' MMM d",
  month: "MMMM yyyy",
};

export function CreateTaskDialog({
  date,
  view,
  onCreated,
}: {
  date: Date;
  view: ViewMode;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const user = useUserStore((state) => state.user);
  const workDays = user?.workDays ?? [1, 2, 3, 4, 5];
  const tz = user?.timezone || "UTC";
  const form = useTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      tags: "",
      note: "",
      deadlineDate: "",
      deadlineTime: "",
      recurrenceMode: "specific",
      byweeks: [1],
      frequency: "WEEKLY",
      interval: 1,
      byday: ["MO"],
      bymonthday: 1,
      bysetpos: 1,
      bydayMonth: "MO",
      monthlyMode: "on",
      yearlyMode: "on",
      isFixed: false,
      fixedStart: isZonedToday(date, tz)
        ? snapToNearestLaterQuarterHour(
            date.getHours() * 60 + date.getMinutes(),
          )
        : 9 * 60,
      fixedEnd: isZonedToday(date, tz)
        ? snapToNearestLaterQuarterHour(
            date.getHours() * 60 + date.getMinutes(),
          ) + 60
        : 10 * 60,
      isRecurring: false,
      month: 1,
      endMode: "never",
      count: 1,
      until: undefined,
    },
  });
  const note = form.watch("note");
  const { newUploadsRef, updateRemovedFileIds, removedFileIds } =
    useFilesTracker();

  useEffect(() => {
    updateRemovedFileIds(note || "", "");
  }, [note]);

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
      await createTask({
        title: values.title,
        note: values.note || null,
        durationMinutes: values.duration,
        tags: parseTags(values.tags),
        deadline,
        fixed: values.isFixed,
        startTime: values.isFixed ? values.fixedStart : 0,
        // Always the viewed day: a fixed anchor when fixed, otherwise the
        // earliest day the flexible engine may place the task on.
        startDate: format(date, "yyyy-MM-dd"),
        rrule:
          values.isRecurring && view !== "day"
            ? generateRRule(values, { view, date, workDays })
            : "",
      });
      onCreated();
      form.reset();
      toast.success("Task created successfully 🎉");
      setOpen(false);
    } catch (error: any) {
      toast.error(
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
      toast.error(
        error.message || "Something went wrong when cancelling task creation",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          <span className="sr-only sm:not-sr-only">New task</span>
        </Button>
      </SheetTrigger>
      {/* Non-modal + no overlay + offset below the 56px header so the view can
          still be switched (which re-scopes recurrence) while creating. */}
      <SheetContent
        showOverlay={false}
        className="inset-y-auto top-14 h-[calc(100vh-3.5rem)] w-full gap-0 p-0 sm:w-96 sm:max-w-md"
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
          view={view}
          date={date}
          workDays={workDays}
          submitLabel="Create Task"
        />
      </SheetContent>
    </Sheet>
  );
}
