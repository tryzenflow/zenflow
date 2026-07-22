import {
  getTaskDetails,
  removeTask,
  resizeTask,
  updateTask,
} from "@/api/tasks";
import { Trash2 } from "@/components/Icons";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetFooter,
  useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useTaskForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import type { BottomSheetFooterProps } from "@gorhom/bottom-sheet";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import type { EditTaskFormValues } from "@zenflow/core";
import type { Task } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { Pressable, View } from "react-native";
import { TaskSheetFields } from "./task-sheet-fields";

const EMPTY_DEFAULTS: EditTaskFormValues = {
  title: "",
  duration: 60,
  tags: [],
  note: "",
  deadline: "",
};

export type EditTaskSheetHandle = {
  open: (taskId: string) => void;
};

/**
 * `EditTaskSheet` — RN port of
 * `frontend/src/components/tasks/edit-task-dialog.tsx` (RN migration
 * Phase 5 / GitHub issue #20): pre-filled fields, "Edit task" header, a
 * delete affordance, "Save changes" submit.
 *
 * Imperative-handle controlled (`ref.current.open(taskId)`) — see
 * `create-task-sheet.tsx`'s doc comment for why: `useControlledBottomSheet`
 * drove `present()`/`dismiss()` from a `useEffect` keyed on an external
 * `open` prop, i.e. one render tick *after* the triggering press handler,
 * unlike every other working sheet in the app which calls
 * `useBottomSheet().open()`/`.close()` synchronously inside the press
 * handler itself.
 *
 * Delete confirmation: the web dialog's `onDelete` calls
 * `deleteTask`/`removeTask` directly on tap, no confirm step — this matches
 * that exactly (no confirmation sheet/alert added here either), resolving
 * the issue's open question the same way the existing web behaviour already
 * answers it.
 *
 * Duration: `UpdateTaskInput` (the `PATCH /tasks/:id` body) has no
 * `durationMinutes` field — only `PATCH /tasks/:id/resize` can change it.
 * Since this sheet's mockup keeps the duration stepper editable (see
 * `TaskSheetFields`'s doc comment), `onSubmit` below issues a second
 * `resizeTask` call when the stepper's value differs from the task's
 * current duration, using its existing `scheduledStartTime` (no visible
 * placement change — this is a duration-only resize, exactly what
 * `ChangeDurationSheet` also does for the long-press gesture).
 */
export const EditTaskSheet = forwardRef<
  EditTaskSheetHandle,
  { onSaved: () => void; onDeleted: () => void }
>(function EditTaskSheet({ onSaved, onDeleted }, ref) {
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const bottomSheet = useBottomSheet();
  const [task, setTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useTaskForm({ defaultValues: EMPTY_DEFAULTS });
  const loading = form.formState.isSubmitting || deleting;

  useImperativeHandle(
    ref,
    () => ({
      open: (taskId: string) => {
        getTaskDetails(taskId).then((res) => {
          setTask(res.task);
          form.reset({
            title: res.task.title,
            duration: res.task.durationMinutes,
            tags: res.task.tags,
            note: res.task.note ?? "",
            deadline: res.task.deadline ?? "",
          });
        });
        bottomSheet.open();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function onSubmit(values: EditTaskFormValues) {
    if (!user || !task) return;
    try {
      await updateTask(task.id, {
        title: values.title,
        note: values.note || null,
        deadline: values.deadline,
        tags: values.tags,
      });
      if (values.duration !== task.durationMinutes && task.scheduledStartTime) {
        await resizeTask(task.id, task.scheduledStartTime, values.duration);
      }
      onSaved();
      toast("Task updated", "success");
      bottomSheet.close();
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
      onDeleted();
      toast("Task deleted", "success");
      bottomSheet.close();
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

  const renderFooter = useCallback(
    (footerProps: BottomSheetFooterProps) => (
      <BottomSheetFooter bottomSheetFooterProps={footerProps}>
        <Button
          className="h-[52px] w-full"
          disabled={loading}
          onPress={form.handleSubmit(onSubmit, onInvalid)}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            {loading ? "Saving…" : "Save changes"}
          </Text>
        </Button>
      </BottomSheetFooter>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, task, user],
  );

  return (
    <BottomSheet>
      <BottomSheetContent
        ref={bottomSheet.ref}
        onDismiss={() => setTask(null)}
        enableDynamicSizing={false}
        snapPoints={["90%"]}
        footerComponent={renderFooter}
      >
        <BottomSheetScrollView
          className="px-5 pt-1"
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="mb-4 flex-row items-start justify-between gap-3">
            <View>
              <Text className="text-[19px] font-bold tracking-tight">
                Edit task
              </Text>
              {task && (
                <Text className="mt-[3px] text-[13px] text-muted-foreground">
                  Created {format(new Date(task.createdAt), "MMM d")}
                </Text>
              )}
            </View>
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
          </View>
          <TaskSheetFields form={form} tz={tz} disabled={loading} editing />
        </BottomSheetScrollView>
      </BottomSheetContent>
    </BottomSheet>
  );
});
