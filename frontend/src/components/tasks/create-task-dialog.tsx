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
import { generateRRule, TaskFormValues } from "../../utils/tasks";
import { TaskForm } from "./form/task-form";
import { PlusIcon } from "lucide-react";

export function CreateTaskDialog({
  addTask,
  selectedDate,
}: {
  addTask: (task: Task, scheduleDate: Date) => Promise<void>;
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
    const allPrerequisites = Promise.all([
      getData<{ data: Task[] }>(
        `/tasks?start=${formattedScheduleDate}&end=${formattedScheduleDate}`,
      ),

      getData<{ data: { recurring: Task[] } }>(
        `/tasks/schedule/none?start=${formattedScheduleDate}&end=${formattedScheduleDate}`,
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
        priority: values.priority,
        earliestStart: values.earliestStart,
        latestEnd: values.latestEnd,
        prerequisites: values.prerequisites,
        categoryId: values.categoryId,
        focus: values.focus,
        maxSplits: values.maxSplits,
        duration: values.duration,
        mandatory: values.mandatory,
        scheduleDate: format(values.scheduleDate, "yyyy-MM-dd"),
        deadlineDate,
        deadlineTime,
        rrule: values.isRecurring ? generateRRule(values) : undefined,
      });
      await addTask(response.data, values.scheduleDate);
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
      <DialogContent className="overflow-x-hidden rounded-none max-w-none sm:max-w-none w-screen overflow-y-auto h-screen px-4 sm:px-6 lg:px-8 py-6">
        <DialogHeader className="max-w-7xl mx-auto w-full">
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
