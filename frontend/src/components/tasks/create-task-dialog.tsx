import { useState, useEffect } from "react";
import { format, addMinutes } from "date-fns";
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
import { Task, TaskResponse } from "../../types/tasks";
import { TaskForm } from "./form/task-form";
import { useTaskForm } from "@/hooks/use-task-form";
import { TaskFormValues } from "../../utils/tasks";
import { militaryTimeToMinutes } from "../../utils/prefs";

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
    console.log("Fetch prerequisites tasks");
    const formattedScheduleDate = format(scheduleDate, "yyyy-MM-dd");

    getData<{ data: Task[] }>(
      `/tasks?start=${formattedScheduleDate}&end=${formattedScheduleDate}`
    ).then(({ data }) => {
      setTasks(data);
      console.log(`Fetch tasks on ${formattedScheduleDate}`, data);
    });
  }, [scheduleDate, open]);

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
    // @ts-ignore
    payload.scheduleDate = formattedScheduleDate;
    delete payload.deadlineTime;
    delete payload.deadlineDate;
    setLoading(true);
    try {
      const response = await postData<object, TaskResponse>("/tasks", payload);
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
