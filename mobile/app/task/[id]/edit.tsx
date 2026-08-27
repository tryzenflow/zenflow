import { getSessionDetails, removeSession, updateSession } from "@/api/tasks";
import { Trash2 } from "@/components/Icons";
import { SessionFormScreen } from "@/components/tasks/task-form-screen";
import { SessionSheetFields } from "@/components/tasks/task-sheet-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useSessionForm } from "@/hooks/use-task-form";
import { useUserStore } from "@/hooks/use-user-store";
import type { EditSessionFormValues } from "@zenflow/core";
import type { Session } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { format } from "date-fns";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

const EMPTY_DEFAULTS: EditSessionFormValues = {
  title: "",
  duration: 60,
  tags: [],
  note: "",
  deadline: "",
};

/**
 * "Edit task" — full screen (was `EditSessionSheet`; see mobile/README.md /
 * `app/task/new.tsx`'s doc comment for why). `id` comes from the route
 * param; fetches once on mount, same as the sheet's `open(taskId)` used to.
 *
 * Delete confirmation: matches the web dialog's `onDelete` — no confirm
 * step, tap deletes immediately (unchanged from the sheet version).
 *
 * Duration: `UpdateSessionInput` (the `PATCH /tasks/:id` body) accepts
 * `durationMinutes` directly alongside the rest of the metadata, so
 * `onSubmit` writes everything — including the stepper's value — in one
 * `updateSession` call.
 */
export default function EditSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const { toast } = useToast();
  const [task, setSession] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useSessionForm({ defaultValues: EMPTY_DEFAULTS });
  // `!task` (still fetching) counts as loading too — Save/Delete would
  // otherwise be tappable against `EMPTY_DEFAULTS` for a moment, and the
  // note field below is gated on `task` specifically (see its comment).
  const loading = !task || form.formState.isSubmitting || deleting;

  useEffect(() => {
    getSessionDetails(id).then((res) => {
      setSession(res);
      form.reset({
        title: res.title,
        duration: res.durationMinutes,
        tags: res.tags,
        note: res.note ?? "",
        deadline: res.deadline ?? "",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(values: EditSessionFormValues) {
    if (!user || !task) return;
    try {
      await updateSession(task.id, {
        title: values.title,
        note: values.note || null,
        deadline: values.deadline,
        tags: values.tags,
        durationMinutes: values.duration,
      });
      toast("Session updated", "success");
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
      await removeSession(task.id);
      toast("Session deleted", "success");
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
    <SessionFormScreen
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
          <Text className="text-base font-semibold text-foreground">
            {loading ? "Saving…" : "Save changes"}
          </Text>
        </Button>
      }
    >
      {task ? (
        <SessionSheetFields
          initialValue={task.note || ""}
          form={form}
          tz={tz}
          disabled={loading}
          editing
        />
      ) : (
        // Mounting the form before `task` resolves is the likely source of
        // the "note briefly shows stale content" report: `DescriptionField`'s
        // WebView editor only reads its `initialValue` prop once, at mount —
        // unlike the other fields (title/duration/deadline/tags), which
        // reactively re-sync via `form.reset` once `task` loads, nothing
        // re-syncs the WebView's own document if it already mounted against
        // a stale/empty `task?.note`. Gating the whole form on `task` means
        // the editor's very first mount already has the correct note, no
        // race, no re-sync needed.
        <View className="items-center py-16">
          <ActivityIndicator />
          <Text className="mt-3 text-sm text-muted-foreground">
            Loading task…
          </Text>
        </View>
      )}
    </SessionFormScreen>
  );
}
