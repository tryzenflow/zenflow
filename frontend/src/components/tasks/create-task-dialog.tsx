import { useState, useEffect } from "react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { postData, getData } from "../../api";
import { CategoryItem } from "../../types/prefs";
import { Task } from "../../types/tasks";
import { TaskForm } from "./form/task-form";
import { useCreateTaskForm } from "@/hooks/use-create-task";
import { TaskFormValues } from "../../utils/tasks";

export function CreateTaskDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  const { form, scheduleDate } = useCreateTaskForm({
    defaultValues: {
      title: "",
      duration: 60,
      mandatory: true,
      priority: 2,
      focus: 2,
      maxSplits: 1,
      scheduleDate: new Date(),
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

  async function onSubmit(values: TaskFormValues) {
    let deadline = undefined;
    if (values.deadlineDate) {
      deadline = `${format(values.deadlineDate, "yyyy-MM-dd")}T${
        values.deadlineTime ?? "00:00"
      }:00.000Z`;
    }

    const payload: any = { ...values };
    payload.deadline = deadline;
    payload.scheduleDate = format(values.scheduleDate, "yyyy-MM-dd");
    delete payload.deadlineTime;
    delete payload.deadlineDate;
    setLoading(true);
    try {
      await postData("/tasks", payload);
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

  const handleClose = () => {
    form.reset();
    setOpen(false);
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
          loading={loading}
          tasks={tasks}
          categories={categories}
          onCancel={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
