import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTaskForm } from "@/hooks/use-task-form";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getData, patchData, postData } from "../../api";
import { CategoryItem, DAILY_HORIZON } from "../../types/prefs";
import { Task } from "../../types/tasks";
import { generateRRule, parseRRule, TaskFormValues } from "../../utils/tasks";
import { TaskForm } from "./form/task-form";
import { useFilesTracker } from "../../hooks/use-files-tracker";

interface EditTaskDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  taskId: string;
  selectedDate: Date;
  updateSchedule: (task: Task) => void;
}

const defaultRecurringFields = {
  frequency: "WEEKLY",
  interval: 1,
  byweekday: ["MO"],
  bymonthday: 1,
  bysetpos: 1,
  byweekdayMonth: "MO",
  monthlyMode: "on",
  yearlyMode: "on",
  isRecurring: false,
  month: 1,
  endMode: "never",
  count: 1,
  until: undefined,
};
export function EditTaskDialog({
  open,
  setOpen,
  taskId,
  selectedDate,
  updateSchedule,
}: EditTaskDialogProps) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const { newUploadsRef } = useFilesTracker();

  useEffect(() => {
    if (!open) return;
    getData<{ data: Task | null }>(`/tasks/${taskId}`).then(({ data }) =>
      setTask(data),
    );
  }, [taskId, open]);

  const form = useTaskForm({
    defaultValues: {
      ...(defaultRecurringFields as any),
      title: "",
      duration: 60,
      mandatory: true,
      priority: 2,
      focus: 2,
      maxSplits: 1,
      scheduleDate: selectedDate,
      note: "",
      earliestStart: 0,
      latestEnd: DAILY_HORIZON,
      prerequisites: [],
      deadlineDate: "",
      deadlineTime: "",
    },
  });
  const scheduleDate = form.watch("scheduleDate");

  useEffect(() => {
    if (!open) return;
    getData<{ data: CategoryItem[] }>("/categories").then((data) => {
      setCategories(data.data);
    });
  }, [open]);

  useEffect(() => {
    if (!scheduleDate || !open) {
      setTasks([]);
      return;
    }
    const formattedScheduleDate = format(scheduleDate, "yyyy-MM-dd");
    const allPrerequisites = Promise.all([
      getData<{ data: Task[] }>(
        `/tasks?start=${formattedScheduleDate}&end=${formattedScheduleDate}`,
      ),

      getData<{ data: { recurring: Task[] } }>(
        `/tasks/none?start=${formattedScheduleDate}&end=${formattedScheduleDate}`,
      ),
    ]);

    allPrerequisites.then(
      ([
        { data },
        {
          data: { recurring },
        },
      ]) => {
        setTasks([...data, ...recurring]);
      },
    );
  }, [scheduleDate, open]);

  useEffect(() => {
    if (!task) return;
    const parsedFields = task.rrule
      ? parseRRule(task.rrule)
      : (defaultRecurringFields as any);
    const fields = {
      ...task,
      ...parsedFields,
      isRecurring: !!task.rrule,
      note: task.note ?? "",
      scheduleDate: selectedDate,
      categoryId: task.categoryId ?? undefined,
      prerequisites:
        task.prerequisites?.map((p) => (typeof p === "string" ? p : p.id)) ??
        [],
      earliestStart: task.earliestStart ?? 0,
      latestEnd: task.latestEnd ?? DAILY_HORIZON,
      deadlineDate: task.deadline
        ? format(new Date(task.deadline), "yyyy-MM-dd")
        : "",
      deadlineTime: task.deadline
        ? format(new Date(task.deadline), "HH:mm")
        : "",
    };
    form.reset(fields);
  }, [task, selectedDate]);

  async function onSubmit(values: TaskFormValues) {
    // setLoading(true);
    const formattedScheduleDate = format(values.scheduleDate, "yyyy-MM-dd");
    const formattedSelectedDate = format(selectedDate, "yyyy-MM-dd");
    const deadlineDate = values.deadlineDate || undefined;
    const deadlineTime = values.deadlineTime || undefined;
    try {
      const updated = await patchData<object, { data: Task }>(
        `/tasks/${taskId}`,
        {
          title: values.title,
          note: values.note,
          priority: values.priority,
          earliestStart: values.earliestStart,
          latestEnd: values.latestEnd,
          prerequisites: values.prerequisites,
          categoryId: values.categoryId,
          focus: values.focus,
          maxSplits: values.maxSplits,
          duration: values.duration,
          mandatory: values.mandatory,
          scheduleDate:
            formattedScheduleDate === formattedSelectedDate
              ? undefined
              : formattedScheduleDate,
          deadlineDate,
          deadlineTime,
          rrule: values.isRecurring ? generateRRule(values) : undefined,
        },
      );
      updateSchedule(updated.data);
      form.reset();
      toast.success("Task updated successfully 🎉");
      setOpen(false);
    } catch (error: any) {
      toast.error(
        error.message || "Something went wrong when updating the task",
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-x-hidden rounded-none max-w-none sm:max-w-none w-screen overflow-y-auto h-screen px-4 sm:px-6 lg:px-8">
        <DialogHeader className="max-w-7xl mx-auto w-full">
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <TaskForm
          form={form as any}
          onSubmit={onSubmit}
          loading={loading}
          tasks={tasks.filter((t) => t.id !== taskId)}
          categories={categories}
          onCancel={handleClose}
          newUploadsRef={newUploadsRef}
          initialNote={task?.note}
        />
      </DialogContent>
    </Dialog>
  );
}
