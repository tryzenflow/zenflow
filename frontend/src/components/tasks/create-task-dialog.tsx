import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTaskForm } from "@/hooks/use-task-form";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getData, postData } from "../../api";
import { useFilesTracker } from "../../hooks/use-files-tracker";
import { useUserStore } from "../../hooks/use-user-store";
import { Category, Task, TaskResponse } from "../../types/tasks";
import { generateRRule, TaskFormValues } from "../../utils/tasks";
import { TaskForm } from "./form/task-form";
import { PlusIcon } from "lucide-react";

export function CreateTaskDialog({
  addTask,
}: {
  addTask: (task: Task) => Promise<void>;
  selectedDate: Date;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const user = useUserStore((state) => state.user);
  const form = useTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      energy: 2,
      note: "",
      deadlineDate: "",
      deadlineTime: "",
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
    },
  });
  const note = form.watch("note");
  const { newUploadsRef, updateRemovedFileIds, removedFileIds } =
    useFilesTracker();

  useEffect(() => {
    updateRemovedFileIds(note || "", "");
  }, [note]);

  useEffect(() => {
    if (!open) return;
    getData<{ data: Category[] }>("/categories").then((data) => {
      setCategories(data.data);
    });
  }, [open]);

  async function onSubmit(values: TaskFormValues) {
    if (!user) return;
    setLoading(true);

    const deadlineDate = values.deadlineDate || undefined;
    const deadlineTime = values.deadlineTime || undefined;
    const removed = removedFileIds.current;

    try {
      if (removed.length > 0) await postData("/files/remove", { ids: removed });
      const response = await postData<object, TaskResponse>("/tasks", {
        title: values.title,
        note: values.note,
        categoryId: values.categoryId,
        focus: values.energy,
        duration: values.duration,
        deadlineDate,
        deadlineTime,
        rrule: values.isRecurring ? generateRRule(values) : undefined,
      });
      await addTask(response.data);
      form.reset();
      toast.success("Task created successfully 🎉");
      setOpen(false);
    } catch (error: any) {
      toast.error(
        error.message || "Something went wrong when creating a new task",
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
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PlusIcon className="size-4" />
          Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
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
