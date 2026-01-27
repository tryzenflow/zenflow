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
import { Category, Task } from "../../types/tasks";
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
  byday: ["MO"],
  bymonthday: 1,
  bysetpos: 1,
  bydayMonth: "MO",
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
  const [categories, setCategories] = useState<Category[]>([]);
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
      energy: 2,
      note: "",
      deadlineDate: "",
      deadlineTime: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    getData<{ data: Category[] }>("/categories").then((data) => {
      setCategories(data.data);
    });
  }, [open]);

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
      categoryId: task.categoryId ?? undefined,
      deadlineDate: task.deadline
        ? format(new Date(task.deadline), "yyyy-MM-dd")
        : "",
      deadlineTime: task.deadline
        ? format(new Date(task.deadline), "HH:mm")
        : "",
    };
    form.reset(fields);
  }, [task, form, selectedDate]);

  async function onSubmit(values: TaskFormValues) {
    setLoading(true);
    const deadlineDate = values.deadlineDate || undefined;
    const deadlineTime = values.deadlineTime || undefined;
    try {
      const updated = await patchData<object, { data: Task }>(
        `/tasks/${taskId}`,
        {
          title: values.title,
          note: values.note,
          categoryId: values.categoryId,
          focus: values.energy,
          duration: values.duration,
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
      <DialogContent>
        <DialogHeader>
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
