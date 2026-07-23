import {
  getTaskDetails,
  removeTask,
  resizeTask,
  updateTask,
} from "@/api/tasks";
import { Trash2 } from "@/components/Icons";
import { TaskFormScreen } from "@/components/tasks/task-form-screen";
import { TaskSheetFields } from "@/components/tasks/task-sheet-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useTaskForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import type { EditTaskFormValues } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";

const EMPTY_DEFAULTS: EditTaskFormValues = {
  title: "",
  duration: 60,
  tags: [],
  note: "",
  deadline: "",
};

/**
 * "Edit task" — full screen (was `EditTaskSheet`; see mobile/README.md /
 * `app/task/new.tsx`'s doc comment for why). `id` comes from the route
 * param; fetches once on mount, same as the sheet's `open(taskId)` used to.
 *
 * Delete confirmation: matches the web dialog's `onDelete` — no confirm
 * step, tap deletes immediately (unchanged from the sheet version).
 *
 * Duration: `UpdateTaskInput` (the `PATCH /tasks/:id` body) has no
 * `durationMinutes` field — only `PATCH /tasks/:id/resize` can change it.
 * `TaskSheetFields` keeps the duration stepper editable in edit mode
 * (mobile has no drag-resize handles), so `onSubmit` issues a second
 * `resizeTask` call when the stepper's value differs from the task's
 * current duration, unchanged from the sheet version.
 */
export default function EditTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useTaskForm({ defaultValues: EMPTY_DEFAULTS });
  const loading = form.formState.isSubmitting || deleting;

  useEffect(() => {
    getTaskDetails(id).then((res) => {
      setTask(res.task);
      form.reset({
        title: res.task.title,
        duration: res.task.durationMinutes,
        tags: res.task.tags,
        note: res.task.note ?? "",
        deadline: res.task.deadline ?? "",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: EditTaskFormValues) {
    if (!user || !task) return;
    try {
      await updateTask(task.id, {
        title: values.title,
        note: values.note || null,
        deadline: values.deadline,
        tags: values.tags,
      });
      if (
        values.duration !== task.durationMinutes &&
        task.scheduledStartTime
      ) {
        await resizeTask(task.id, task.scheduledStartTime, values.duration);
      }
      toast("Task updated", "success");
      router.back();
    } catch (error) {
      const message =
        (isAxiosError(error) &&
          (error.response?.data as { message?: string } | undefined)
            ?.message) ||
        "Failed to update task";
      toast(message, "destructive");
    }
  }

  function onInvalid(errors: Record<string, { message?: string } | undefined>) {
    const first = Object.values(errors)[0];
    if (first?.message) toast(String(first.message), "destructive");
  }

  async function onDelete() {
    if (!task) return;
    setDeleting(true);
    try {
      await removeTask(task.id);
      toast("Task deleted", "success");
      router.back();
    } catch (error) {
      const message =
        (isAxiosError(error) &&
          (error.response?.data as { message?: string } | undefined)
            ?.message) ||
        "Failed to delete task";
      toast(message, "destructive");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <TaskFormScreen
      title="Edit task"
      subtitle={
        task
          ? `Created ${format(new Date(task.createdAt), "MMM d")}`
          : undefined
      }
      headerRight={
        <Pressable
          disabled={loading}
          onPress={onDelete}
          className="flex-row items-center gap-1.5"
          accessibilityLabel="Delete task"
        >
          <Trash2 size={15} className="text-destructive" />
          <Text className="text-[13px] font-semibold text-destructive">
            Delete
          </Text>
        </Pressable>
      }
      footer={
        <Button
          className="h-[52px] w-full"
          disabled={loading}
          onPress={form.handleSubmit(onSubmit, onInvalid)}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            {loading ? "Saving…" : "Save changes"}
          </Text>
        </Button>
      }
    >
      <TaskSheetFields form={form} tz={tz} disabled={loading} editing />
    </TaskFormScreen>
  );
}
