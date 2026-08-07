import { createTask } from "@/api/tasks";
import { TaskFormScreen } from "@/components/tasks/task-form-screen";
import { TaskSheetFields } from "@/components/tasks/task-sheet-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useTaskForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import { placementToastMessage } from "@/lib/task-toasts";
import type { TaskFormValues } from "@zenflow/core";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";

const DEFAULT_DURATION = 60;

const EMPTY_DEFAULTS: TaskFormValues = {
  title: "",
  duration: DEFAULT_DURATION,
  tags: [],
  note: "",
  deadline: "",
};

/**
 * "New task" — full screen (was `CreateTaskSheet`, a `@gorhom/bottom-sheet`
 * modal; see mobile/README.md for why the task form moved off bottom
 * sheets). Reached via `router.push` from `CreateTaskFab`/the Day screen's
 * long-press-empty-area gesture, optionally with a `start` query param (ISO
 * instant, already snapped to the 15-min grid) — informational only, shown
 * in the subtitle; the deadline chip row inside `TaskSheetFields` is what
 * the schema actually validates, unchanged from the sheet version.
 */
export default function NewTaskScreen() {
  const { start } = useLocalSearchParams<{ start?: string }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();

  const initialStart = useMemo(
    () => (start ? new Date(start) : undefined),
    [start],
  );
  const form = useTaskForm({ defaultValues: EMPTY_DEFAULTS });
  const loading = form.formState.isSubmitting;

  async function onSubmit(values: TaskFormValues) {
    if (!user) return;
    try {
      const response = await createTask({
        title: values.title,
        note: values.note || null,
        durationMinutes: values.duration,
        tags: values.tags,
        deadline: values.deadline,
      });
      const { message, variant } = placementToastMessage(response.task, user);
      toast(message, variant === "success" ? "success" : "destructive");
      router.back();
    } catch (error) {
      const message =
        (isAxiosError(error) &&
          (error.response?.data as { message?: string } | undefined)
            ?.message) ||
        "Something went wrong when creating a new task";
      toast(message, "destructive");
    }
  }

  function onInvalid(errors: Record<string, { message?: string } | undefined>) {
    const first = Object.values(errors)[0];
    if (first?.message) toast(String(first.message), "destructive");
  }

  const subtitle = initialStart
    ? `${format(initialStart, "EEEE, MMM d")} · starts ${format(
        initialStart,
        "h:mm a",
      )}`
    : "New task";

  return (
    <TaskFormScreen
      title="New task"
      subtitle={subtitle}
      footer={
        <Button
          className="h-[52px] w-full text-primary-foreground"
          disabled={loading}
          onPress={form.handleSubmit(onSubmit, onInvalid)}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            {loading ? "Adding…" : "Add task"}
          </Text>
        </Button>
      }
    >
      <TaskSheetFields form={form} tz={tz} disabled={loading} />
    </TaskFormScreen>
  );
}
