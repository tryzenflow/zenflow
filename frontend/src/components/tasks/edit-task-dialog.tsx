import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTaskForm } from "@/hooks/use-task-form";
import { addDays, addMinutes, format, startOfDay } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getData, patchData } from "../../api";
import { CategoryItem } from "../../types/prefs";
import { Task } from "../../types/tasks";
import { TaskFormValues } from "../../utils/tasks";
import { TaskForm } from "./form/task-form";
import { militaryTimeToMinutes } from "../../utils/prefs";

interface EditTaskDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  taskId: string;
  selectedDate: Date;
  updateSchedule: (task: Task) => void;
}

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

  useEffect(() => {
    if (!open) return;
    getData<{ data: Task | null }>(`/tasks/${taskId}`).then(({ data }) =>
      setTask(data)
    );
  }, [taskId, open]);

  const { form, scheduleDate } = useTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      mandatory: true,
      priority: 2,
      focus: 2,
      maxSplits: 1,
      scheduleDate: selectedDate,
      note: "",
      earliestStart: undefined,
      latestEnd: undefined,
      deadlineDate: undefined,
      deadlineTime: undefined,
      categoryId: undefined,
      prerequisites: undefined,
    },
  });

  useEffect(() => {
    if (!open) return;
    getData<CategoryItem[]>("/categories").then((data) => {
      setCategories(data);
    });
  }, [open]);

  useEffect(() => {
    if (!scheduleDate || !open) return;
    const nextDay = format(addDays(scheduleDate, 1), "yyyy-MM-dd");
    getData<{ data: Task[] }>(
      `/tasks?start=${format(scheduleDate, "yyyy-MM-dd")}&end=${nextDay}`
    ).then(({ data }) => setTasks(data));
  }, [scheduleDate, open]);

  useEffect(() => {
    if (!task) return;

    form.reset({
      ...task,
      note: task.note ?? "",
      scheduleDate: selectedDate,
      categoryId: task.categoryId ?? undefined,
      prerequisites: task.prerequisites?.map((p) =>
        typeof p === "string" ? p : p.id
      ),
      deadlineDate: task.deadline
        ? startOfDay(new Date(task.deadline))
        : undefined,
      deadlineTime: task.deadline
        ? format(new Date(task.deadline), "HH:mm")
        : undefined,
    });
  }, [task, selectedDate]);

  async function onSubmit(values: TaskFormValues) {
    let deadline = undefined;
    if (values.deadlineDate) {
      deadline = addMinutes(
        new Date(values.deadlineDate),
        militaryTimeToMinutes(values.deadlineTime ?? "00:00")
      );
    }

    const formattedScheduleDate = format(values.scheduleDate, "yyyy-MM-dd");

    const payload = { ...values, deadline };
    payload.deadline = deadline;
    if (formattedScheduleDate === format(selectedDate, "yyyy-MM-dd")) {
      // @ts-ignore
      delete payload.scheduleDate;
    } else {
      // @ts-ignore
      payload.scheduleDate = formattedScheduleDate;
    }
    delete payload.deadlineTime;
    delete payload.deadlineDate;
    setLoading(true);
    try {
      const updated = await patchData<any, { data: Task }>(
        `/tasks/${taskId}`,
        payload
      );

      updateSchedule(updated.data);
      form.reset();
      toast.success("Task updated successfully 🎉");
      setOpen(false);
    } catch (error: any) {
      toast.error(
        error.message || "Something went wrong when updating the task"
      );
    } finally {
      setLoading(false);
    }
  }

  const handleClose = () => {
    form.reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[500px] overflow-x-hidden md:max-w-[600px] overflow-y-auto max-h-[90vh]">
        <DialogHeader className="space-y-0">
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>

        <TaskForm
          form={form as any}
          onSubmit={onSubmit}
          loading={loading}
          tasks={tasks.filter((t) => t.id !== taskId)}
          categories={categories}
          onCancel={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
