import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTaskForm } from "@/hooks/use-task-form";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getData, postData } from "../../api";
import { useFilesTracker } from "../../hooks/use-files-tracker";
import { useUserStore } from "../../hooks/use-user-store";
import { CategoryItem, DAILY_HORIZON } from "../../types/prefs";
import { Task, TaskResponse } from "../../types/tasks";
import { TaskFormValues } from "../../utils/tasks";
import { TaskForm } from "./form/task-form";

export function CreateTaskDialog({
  addTask,
  selectedDate,
}: {
  addTask: (task: Task) => Promise<void>;
  selectedDate: Date;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const user = useUserStore((state) => state.user);
  const form = useTaskForm({
    defaultValues: {
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
    },
  });
  const note = form.watch("note");
  const { newUploadsRef, updateRemovedFileIds, removedFileIds } =
    useFilesTracker();
  const scheduleDate = form.watch("scheduleDate");

  useEffect(() => {
    updateRemovedFileIds(note || "", "");
  }, [note]);

  useEffect(() => {
    form.setValue("scheduleDate", selectedDate);
  }, [selectedDate]);

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

    getData<{ data: Task[] }>(
      `/tasks?start=${formattedScheduleDate}&end=${formattedScheduleDate}`
    ).then(({ data }) => {
      setTasks(data);
    });
  }, [scheduleDate, open]);

  async function onSubmit(values: TaskFormValues) {
    if (!user) return;
    setLoading(true);

    const deadlineDate = values.deadlineDate || undefined;
    const deadlineTime = values.deadlineTime || undefined;
    const removed = removedFileIds.current;

    try {
      if (removed.length > 0) await postData("/files/remove", { ids: removed });
      const response = await postData<object, TaskResponse>("/tasks", {
        ...values,
        scheduleDate: format(values.scheduleDate, "yyyy-MM-dd"),
        deadlineDate,
        deadlineTime,
      });
      await addTask(response.data);
      form.reset();
      toast.success("Task created successfully 🎉");
      setOpen(false);
    } catch (error: any) {
      toast.error(
        error.message || "Something went wrong when creating a new task"
      );
    } finally {
      setLoading(false);
    }
  }

  const handleClose = async () => {
    setLoading(true);
    try {
      await postData("/files/remove", { ids: newUploadsRef.current });
      form.reset();
      setOpen(false);
    } catch (error: any) {
      toast.error(
        error.message || "Something went wrong when cancelling task creation"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Add task</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] overflow-x-hidden md:max-w-[600px] overflow-y-auto max-h-[90vh]">
        <DialogHeader className="space-y-0">
          <DialogTitle>Create new task</DialogTitle>
        </DialogHeader>

        <TaskForm
          form={form as any}
          onSubmit={onSubmit}
          newUploadsRef={newUploadsRef}
          loading={loading}
          tasks={tasks}
          categories={categories}
          onCancel={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
